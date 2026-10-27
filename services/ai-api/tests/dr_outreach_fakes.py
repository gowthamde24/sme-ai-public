"""In-memory double of the outreach repository for job DR A3 (no database). The database's own rules (the plan hash, the hours, the caps, consent, the hand-off) are proved in supabase/tests/database/127_dr_speed_approvals.test.sql."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from app.outreach.errors import OutreachStateError, PlanChangedError
from app.tenancy.repository import UpstreamError

SHA = "a" * 64
NOW = "2026-11-06T10:00:00+00:00"


def batch_doc(batch_id: uuid.UUID, status: str = "planned", **extra: Any) -> dict[str, Any]:
    batch = {
        "id": str(batch_id), "name": "Diwali leads", "status": status, "paused_reason": None, "goal": "site_visit", "channel": "call", "language": "te", "questions": [], "message_text": None,
        "window_days": 7, "max_calls_per_day": None, "max_total_minutes": None, "plan_sha256": SHA, "created_at": NOW, "approved_at": None, "finished_at": None, **extra,
    }
    plan = {
        "count": 3, "ready": 2, "skipped": {"no_phone": 1}, "sample": [{"contact_id": str(uuid.uuid4()), "name_masked": "S*** D***", "city": "Hyderabad"}], "window": {"from": "2026-11-06", "to": "2026-11-13"},
        "estimated_minutes": 6, "estimated_messages": 0, "estimated_cost_paise": 2400, "caps": {"max_calls_per_day": None, "max_total_minutes": None},
    }
    return {"batch": batch, "plan": plan, "progress": {"total": 2, "waiting": 2, "done": 0, "calls_made": 0, "connected": 0, "interested": 0, "minutes_used": 0}}


class FakeOutreachRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.broken = False
        self.state_error = False
        self.stale = False
        self.work: list[dict[str, Any]] = []
        self.reminders_due: list[dict[str, Any]] = []
        self.results: list[tuple[uuid.UUID, str, dict[str, Any] | None, float, bool]] = []
        self.refuse_results = False

    def _hit(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.broken:
            raise UpstreamError("down")

    def policy_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._hit("policy_get", tenant_id)
        return {"night_call_minute": 570, "max_attempts": 3, "retry_gap_hours": 18, "then_whatsapp": True, "whatsapp_after_hours": True, "handoff_reminder_minutes": 15, "call_paise_per_minute": 400,
                "hours": {"days": [1, 2, 3, 4, 5, 6], "from_minute": 540, "to_minute": 1140, "from": "assistant", "holidays": []}, "saved": False}

    def policy_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        self._hit("policy_set", settings)
        return {}

    def batch_plan(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        self._hit("batch_plan", doc)
        out = batch_doc(uuid.UUID(doc["batch_id"]), goal=doc["goal"], channel=doc["channel"], language=doc["language"])
        del out["progress"]
        return out

    def batches(self, token: str, tenant_id: uuid.UUID, status: str | None) -> list[dict[str, Any]]:
        self._hit("batches", status)
        return [batch_doc(uuid.uuid4(), status or "running")]

    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> dict[str, Any]:
        self._hit("batch", batch_id)
        return batch_doc(batch_id)

    def items(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, limit: int, after_at: datetime | None, after_id: uuid.UUID | None) -> list[dict[str, Any]]:
        self._hit("items", batch_id, limit, after_at, after_id)
        row = {"id": str(uuid.uuid4()), "contact_id": str(uuid.uuid4()), "lead_id": None, "name": "Sita Devi", "status": "waiting", "reason": None, "attempts": 0, "next_action": "call", "next_at": NOW,
               "last_result": None, "created_at": "2026-11-06T09:00:00+00:00"}
        return [row] * (2 if after_at else limit)

    def exclude(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, contact_ids: list[uuid.UUID]) -> dict[str, Any]:
        self._hit("exclude", batch_id, contact_ids)
        return batch_doc(batch_id)

    def approve(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, plan_sha256: str) -> dict[str, Any]:
        self._hit("approve", batch_id, plan_sha256)
        if self.stale or plan_sha256 != SHA:
            raise PlanChangedError("SM812")
        if self.state_error:
            raise OutreachStateError("SM811")
        return batch_doc(batch_id, "running", approved_at=NOW)

    def batch_state(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, action: str) -> dict[str, Any]:
        self._hit("batch_state", batch_id, action)
        if self.state_error:
            raise OutreachStateError("SM811")
        return batch_doc(batch_id, {"pause": "paused", "resume": "running", "cancel": "cancelled"}[action])

    def caps(self, token: str, tenant_id: uuid.UUID, kind: str, item_id: uuid.UUID, calls: int | None, minutes: int | None) -> dict[str, Any]:
        self._hit("caps", kind, item_id, calls, minutes)
        return self.rule_doc(item_id) if kind == "rule" else batch_doc(item_id, "running", max_calls_per_day=calls, max_total_minutes=minutes)

    @staticmethod
    def rule_doc(rule_id: uuid.UUID, **extra: Any) -> dict[str, Any]:
        return {"id": str(rule_id), "source": "meta_lead_ads", "action": "call_within_minutes", "within_minutes": 2, "goal": "site_visit", "channel": "call", "language": "te", "questions": [], "message_text": None,
                "max_calls_per_day": 100, "max_total_minutes": None, "active": True, "paused_reason": None, "paused_at": None, "approved_at": NOW, "usage": {"leads": 0, "calls_today": 0, "minutes_used": 0}, **extra}

    def rule_save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        self._hit("rule_save", doc)
        return self.rule_doc(uuid.UUID(doc["rule_id"]), source=doc["source"])

    def rules(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._hit("rules")
        return [self.rule_doc(uuid.uuid4())]

    def rule_state(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, action: str) -> dict[str, Any]:
        self._hit("rule_state", rule_id, action)
        return self.rule_doc(rule_id, active=action == "resume")

    def result(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, result: str, outcome: dict[str, Any] | None, minutes: float, stop: bool) -> dict[str, Any]:
        self._hit("result", item_id, result)
        if self.refuse_results:
            raise OutreachStateError("SM811")
        self.results.append((item_id, result, outcome, minutes, stop))
        return {"item_id": str(item_id), "status": "stopped" if stop else "waiting", "reason": "wrong_number" if stop else None, "next_at": None if stop else NOW}

    def handoffs(self, token: str, tenant_id: uuid.UUID, open_only: bool) -> list[dict[str, Any]]:
        self._hit("handoffs", open_only)
        return [{"id": str(uuid.uuid4()), "lead_id": None, "contact_id": str(uuid.uuid4()), "contact_name": "Sita Devi", "summary": "Sita Devi is interested", "assigned_to": str(uuid.uuid4()), "notified_at": NOW,
                 "reminder_sent_at": None, "acted_at": None}]

    def handoff_acted(self, token: str, tenant_id: uuid.UUID, handoff_id: uuid.UUID) -> dict[str, Any]:
        self._hit("handoff_acted", handoff_id)
        return {**self.handoffs(token, tenant_id, True)[0], "id": str(handoff_id), "acted_at": NOW}

    def report(self, token: str, tenant_id: uuid.UUID, start: date | None, end: date | None) -> dict[str, Any]:
        self._hit("report", start, end)
        row = {"leads": 4, "first_touch_median_seconds": 95, "calls": 6, "connected_rate": 0.5, "interested_pct": 33.3, "bookings": 1, "call_cost_paise": 1200, "lead_cost_paise": 8000, "cost_per_booking_paise": 9200}
        return {"from_day": "2026-11-01", "to_day": "2026-11-30", "by_source": [{"source": "indiamart", **row}], "total": {k: v for k, v in row.items() if k != "first_touch_median_seconds"}}

    def source_costs(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._hit("source_costs")
        return [{"source": "indiamart", "cost_per_lead_paise": 2000}]

    def source_costs_set(self, token: str, tenant_id: uuid.UUID, costs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        self._hit("source_costs_set", costs)
        return costs

    def scan(self, token: str, limit: int) -> dict[str, Any]:
        self._hit("scan", limit)
        return {"added": 2}

    def run(self, token: str, limit: int) -> dict[str, Any]:
        self._hit("run", limit)
        work, self.work = self.work, []
        return {"calls": work, "whatsapp": 1, "paused": 0}

    def reminders(self, token: str, limit: int) -> list[dict[str, Any]]:
        self._hit("reminders", limit)
        due, self.reminders_due = self.reminders_due, []
        return due
