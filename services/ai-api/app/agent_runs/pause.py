"""The one refusal for "the AI allowance is used up" (job AK / K2): HTTP 429 `ai_paused_until`, with the time the AI features can be used again.

Only the AI features pause (the assistant, research, requirement drafting): quotes, orders, follow-ups and customers do not call anything here. The database decides
(the cap helpers every agent start and every model call already use now count the plan's daily AND monthly allowance); this module only words the refusal and finds the time.
The time comes from the database (`ai_paused_until`, any member); if that read fails the next Indian midnight is used, which is never later than the truth is early."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from app.errors import ApiError

logger = logging.getLogger("app.agent_runs.pause")

IST = timezone(timedelta(hours=5, minutes=30))  # India has no daylight saving
CODE = "ai_paused_until"
MESSAGE = (
    "AI help is paused because this workspace's AI allowance for the period is used up. "
    "It starts again at the time shown. Quotes, orders, follow-ups and customers keep working."
)


def next_india_midnight(now: datetime | None = None) -> datetime:
    local = (now or datetime.now(UTC)).astimezone(IST)
    return datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), tzinfo=IST)


def _parse(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def resolve_until(today_repo: Any, token: str, tenant_id: uuid.UUID | None) -> datetime:
    """When the AI is back: the database's answer, else the next Indian midnight."""
    try:
        until = (
            _parse(today_repo.paused_until(token, tenant_id)) if today_repo and tenant_id else None
        )
    except Exception as exc:  # a read that fails must not hide the refusal
        logger.warning("paused_until read failed: %s", exc.__class__.__name__)
        until = None
    return until or next_india_midnight()


def paused_error(until: datetime) -> ApiError:
    return ApiError(
        429,
        CODE,
        MESSAGE,
        extra={"until": until.astimezone(UTC).isoformat().replace("+00:00", "Z")},
    )
