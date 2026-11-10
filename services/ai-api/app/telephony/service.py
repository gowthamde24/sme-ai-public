"""The Calls page, from the database's shape to the API's (job phone-calls part 6): the contact's display name (never an internal id), live calls with their seconds so far, a short summary line for the list, and the
transcript only where the database handed it over (Owner and Admin)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app.display_name import lead_title, real_name
from app.telephony.models import (
    CallDetailOut,
    CallOut,
    CallsOut,
    CorrectionIn,
    CorrectionOut,
    TakeOverSettingOut,
)
from app.telephony.persona import DEFAULT_ASSISTANT

LIVE = ("queued", "ringing", "in_progress")
LIVE_MAX_S = 600   # a call is never shown as live for longer than 10 minutes (owner, 9 Nov 2026)
POLL_AFTER_S = 5
SHORT = 140


def _short(text: Any) -> str | None:
    if not isinstance(text, str) or not text.strip():
        return None
    one = " ".join(text.split())
    return one if len(one) <= SHORT else one[: SHORT - 1].rstrip() + "…"


def _parse(value: Any) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else None


def _name(row: dict[str, Any]) -> str | None:
    """A real name only: the contact's, else the one the caller gave on the call."""
    raw = row.get("captured")
    given = raw.get("name") if isinstance(raw, dict) else None
    return real_name(row.get("contact_name")) or (given.strip() if isinstance(given, str) and given.strip() else None)


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
    # the one definition of "live" is the database's (app.phone_call_is_live: fresh, under 10 minutes old, a heartbeat within 6 minutes); this is the same rule again, so a screen is never told
    # a stale call is live, whichever repository answered
    live = bool(row["state"] in LIVE and row.get("live", True) and (now - created).total_seconds() <= LIVE_MAX_S)
    duration = row.get("duration_s")
    return {
        "id": str(row["id"]), "direction": row["direction"], "state": row["state"], "live": live, "who": _who(row), "name": _name(row),
        "assistant_name": row.get("assistant_name") or DEFAULT_ASSISTANT, "line": row.get("line"), "line_ending": row.get("line_ending"),
        "purpose": row.get("purpose"), "language": row.get("language"), "created_at": created, "answered_at": _parse(row.get("answered_at")), "ended_at": _parse(row.get("ended_at")),
        "elapsed_s": max(0, int((now - (_parse(row.get("answered_at")) or created)).total_seconds())) if live else duration, "duration_s": duration,
        "outcome": row.get("outcome"), "category": row.get("category"), "summary_short": _short(row.get("summary")), "refuse_reason": row.get("refuse_reason"),
        "lead_id": str(row["lead_id"]) if row.get("lead_id") else None, "task_id": str(row["task_id"]) if row.get("task_id") else None,
        "sandbox": bool(row.get("sandbox")), "simulated": bool(row.get("simulated")), "ai_disclosed": bool(row.get("ai_disclosed")), "recorded": False, "cost_paise": int(row.get("cost_paise") or 0),
        "callback_at": _parse(row.get("callback_at")),
    }


class CallsService:
    def __init__(self, repo: Any, clock: Any = lambda: datetime.now(UTC), *, announce_takeover: bool = False) -> None:
        self._repo, self._clock = repo, clock
        self.announce_takeover = announce_takeover   # TAKEOVER_ANNOUNCE: a short spoken announcement to the caller when a person takes over (off by default; owner decision pending)

    # ---- the live take-over switch (job TO) ----------------------------------------------------------------------------------------------------
    def takeover_setting(self, token: str, tenant_id: uuid.UUID) -> TakeOverSettingOut:
        got = self._repo.takeover_get(token, tenant_id)
        return TakeOverSettingOut(enabled=bool(got.get("enabled")), updated_at=_parse(got.get("updated_at")), announces=self.announce_takeover)

    def set_takeover(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> TakeOverSettingOut:
        got = self._repo.takeover_set(token, tenant_id, enabled)
        return TakeOverSettingOut(enabled=bool(got.get("enabled")), updated_at=_parse(got.get("updated_at")), announces=self.announce_takeover)

    def takeover_enabled(self, token: str, tenant_id: uuid.UUID) -> bool:
        """Is take-over switched on for this business? Fails CLOSED: if the setting cannot be read, the answer is no."""
        try:
            return bool(self._repo.takeover_get(token, tenant_id).get("enabled"))
        except Exception as exc:  # noqa: BLE001 - only the class is logged
            logging.getLogger("app.telephony.service").warning("takeover_setting_unreadable %s", exc.__class__.__name__)
            return False

    def takeover_event(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, event: str, **detail: int) -> None:
        """One audit entry for a take-over session event (start, whisper, hang_up, end). Numbers only: never a word that was said."""
        self._repo.takeover_event(token, tenant_id, call_id, event, {k: int(v) for k, v in detail.items()})

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
