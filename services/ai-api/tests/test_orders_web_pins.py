"""The order page repeats the API's refusal sentences and event types by value."""

from __future__ import annotations

import re
from pathlib import Path

from app.main import ORDER_REASON_TEXT
from app.orders.errors import REASONS
from app.orders.models import EventType, LostReason

WEB = (
    Path(__file__).resolve().parents[3] / "apps" / "web" / "lib" / "api" / "orders.ts"
).read_text()


def _table(name: str) -> dict[str, str]:
    body = WEB[WEB.index(f"export const {name}") :]
    body = body[: body.index("};")]
    return dict(re.findall(r'^\s+([A-Z_]+): "([^"]*)",$', body, re.M))


def test_the_pages_refusal_sentences_are_the_apis() -> None:
    assert _table("REFUSAL_TEXT") == ORDER_REASON_TEXT
    assert set(ORDER_REASON_TEXT) == set(REASONS)


def _list(name: str) -> list[str]:
    body = WEB[WEB.index(f"export const {name}") :]
    body = body[: body.index("] as const")]
    return re.findall(r'"([a-z_]+)"', body)


def test_the_pages_event_types_and_lost_reasons_are_the_apis() -> None:
    assert _list("EVENT_TYPES") == list(EventType.__args__)  # type: ignore[attr-defined]
    assert _list("LOST_REASONS") == list(LostReason.__args__)  # type: ignore[attr-defined]
