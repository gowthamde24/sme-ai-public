"""The Calls page, from the database's shape to the API's (job phone-calls part 6): the contact's display name (never an internal id), live calls with their seconds so far, a short summary line for the list, and the
transcript only where the database handed it over (Owner and Admin)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.display_name import lead_title
from app.telephony.models import CallDetailOut, CallOut, CallsOut, CorrectionIn, CorrectionOut

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


def _who(row: dict[str, Any]) -> str:
    """The contact's name or phone; else the name the caller gave on the call; else "Caller ending 998"; else "New enquiry" (an older call)."""
    raw = row.get("captured")
    captured: dict[str, Any] = raw if isinstance(raw, dict) else {}
    title = lead_title(row.get("contact_name"), row.get("contact_phone"))
    if row.get("contact_name") or row.get("contact_phone"):
        return title
    name, ending = captured.get("name"), captured.get("caller_ending")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return f"Caller ending {ending}" if isinstance(ending, str) and ending else title


def shape(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    created = _parse(row["created_at"])
    assert created is not None   # noqa: S101 - the column is not null
    live = row["state"] in LIVE
    duration = row.get("duration_s")
    return {
        "id": str(row["id"]), "direction": row["direction"], "state": row["state"], "live": live, "who": _who(row),
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

    def correct(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, body: CorrectionIn) -> CorrectionOut:
        return CorrectionOut.model_validate(self._repo.correct(token, tenant_id, call_id, body.summary, body.captured, body.note))

    def handled(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]:
        out = self._repo.handled(token, tenant_id, call_id)
        return {"call_id": str(out["call_id"]), "handled_at": out["handled_at"]}

    def get(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> CallDetailOut:
        row = self._repo.get(token, tenant_id, call_id)
        base = shape(row, self._clock())
        transcript = row.get("transcript")
        captured = row.get("captured")
        fixed = row.get("correction")
        return CallDetailOut(**base, summary=row.get("summary"), end_reason=row.get("end_reason"), correction=CorrectionOut.model_validate(fixed) if isinstance(fixed, dict) else None,
                             captured={str(k): str(v) for k, v in captured.items() if k != "caller_ending"} if isinstance(captured, dict) else None,
                             transcript=[t for t in transcript if isinstance(t, dict)] if isinstance(transcript, list) else None)  # type: ignore[misc]
