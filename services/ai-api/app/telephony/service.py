"""The Calls page, from the database's shape to the API's (job phone-calls part 6): the contact's display name (never an internal id), live calls with their seconds so far, a short summary line for the list, and the
transcript only where the database handed it over (Owner and Admin)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.display_name import lead_title
from app.telephony.models import CallDetailOut, CallOut, CallsOut

LIVE = ("queued", "ringing", "in_progress")
POLL_AFTER_S = 5
SHORT = 140


def _short(text: Any) -> str | None:
    if not isinstance(text, str) or not text.strip():
        return None
    one = " ".join(text.split())
    return one if len(one) <= SHORT else one[: SHORT - 1].rstrip() + "…"


def _parse(value: Any) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else None


def shape(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    created = _parse(row["created_at"])
    assert created is not None   # noqa: S101 - the column is not null
    live = row["state"] in LIVE
    duration = row.get("duration_s")
    return {
        "id": str(row["id"]), "direction": row["direction"], "state": row["state"], "live": live, "who": lead_title(row.get("contact_name"), row.get("contact_phone")),
        "purpose": row.get("purpose"), "language": row.get("language"), "created_at": created, "answered_at": _parse(row.get("answered_at")), "ended_at": _parse(row.get("ended_at")),
        "elapsed_s": max(0, int((now - (_parse(row.get("answered_at")) or created)).total_seconds())) if live else duration, "duration_s": duration,
        "outcome": row.get("outcome"), "category": row.get("category"), "summary_short": _short(row.get("summary")), "refuse_reason": row.get("refuse_reason"),
        "lead_id": str(row["lead_id"]) if row.get("lead_id") else None, "task_id": str(row["task_id"]) if row.get("task_id") else None,
        "sandbox": bool(row.get("sandbox")), "simulated": bool(row.get("simulated")), "ai_disclosed": bool(row.get("ai_disclosed")), "recorded": False, "cost_paise": int(row.get("cost_paise") or 0),
        "callback_at": _parse(row.get("callback_at")),
    }


class CallsService:
    def __init__(self, repo: Any, clock: Any = lambda: datetime.now(UTC)) -> None:
        self._repo, self._clock = repo, clock

    def list(self, token: str, tenant_id: uuid.UUID, state: str, limit: int, before: datetime | None) -> CallsOut:
        rows = self._repo.list_calls(token, tenant_id, state, limit + 1, before)
        page, more = rows[:limit], len(rows) > limit
        now = self._clock()
        items = [CallOut(**shape(r, now)) for r in page]
        cursor = page[-1]["created_at"] if more and page else None
        return CallsOut(items=items, next_cursor=cursor, updated_at=now, poll_after_s=POLL_AFTER_S)

    def get(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> CallDetailOut:
        row = self._repo.get(token, tenant_id, call_id)
        base = shape(row, self._clock())
        transcript = row.get("transcript")
        captured = row.get("captured")
        return CallDetailOut(**base, summary=row.get("summary"), end_reason=row.get("end_reason"),
                             captured={str(k): str(v) for k, v in captured.items()} if isinstance(captured, dict) else None,
                             transcript=[t for t in transcript if isinstance(t, dict)] if isinstance(transcript, list) else None)  # type: ignore[misc]
