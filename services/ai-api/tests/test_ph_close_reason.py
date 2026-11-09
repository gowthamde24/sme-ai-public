"""The provider's close reason goes to the end-of-call log as a closed word only (owner, 9 Nov 2026: why did the short calls end?). No number or free text ever."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
from typing import Any

from app.telephony.inbound_routes import StarletteWire


class FakeWs:
    def __init__(self, message: dict[str, Any]) -> None:
        self._message = message

    async def receive(self) -> dict[str, Any]:
        return self._message


def read(message: dict[str, Any]) -> StarletteWire:
    wire = StarletteWire(FakeWs(message))  # type: ignore[arg-type]
    assert asyncio.run(wire.receive_text()) is None
    return wire


def test_a_close_frame_with_a_reason_is_kept_as_a_closed_word() -> None:
    wire = read({"type": "websocket.disconnect", "code": 1000, "reason": "call ended"})
    assert wire.close_code == 1000 and wire.close_reason == "call ended"


def test_free_text_with_numbers_becomes_other_and_no_reason_stays_none() -> None:
    assert read({"type": "websocket.disconnect", "code": 1006, "reason": "caller 9876543210 left"}).close_reason == "other"
    wire = read({"type": "websocket.disconnect", "code": 1005})
    assert wire.close_code == 1005 and wire.close_reason is None


def test_the_stream_is_timed_from_its_opening() -> None:
    wire = StarletteWire(FakeWs({}))  # type: ignore[arg-type]
    from app.telephony.inbound import _stream_seconds

    class Line:
        _wire = wire

    assert _stream_seconds(Line()) is not None and 0 <= _stream_seconds(Line()) < 5  # type: ignore[operator]
