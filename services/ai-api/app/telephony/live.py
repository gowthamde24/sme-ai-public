"""The calls running in THIS process (job phone-calls part 6): so an Owner or Admin can hang one up. A call on another instance is not here; the route says so and the page asks again."""

# ruff: noqa: E501

from __future__ import annotations

import uuid

from app.telephony.line import PhoneLine


class LiveCalls:
    def __init__(self) -> None:
        self._lines: dict[uuid.UUID, tuple[uuid.UUID, PhoneLine]] = {}   # call id -> (tenant id, line)

    def add(self, tenant_id: uuid.UUID, call_id: uuid.UUID, line: PhoneLine) -> None:
        self._lines[call_id] = (tenant_id, line)

    def remove(self, call_id: uuid.UUID) -> None:
        self._lines.pop(call_id, None)

    def count(self) -> int:
        return len(self._lines)

    def count_for(self, tenant_id: uuid.UUID) -> int:
        return sum(1 for t, _ in self._lines.values() if t == tenant_id)

    async def hang_up(self, tenant_id: uuid.UUID, call_id: uuid.UUID, reason: str = "stopped") -> bool:
        """True when the call was here and has been ended. A call of another workspace is never reachable through this."""
        entry = self._lines.get(call_id)
        if entry is None or entry[0] != tenant_id:
            return False
        await entry[1].hang_up(reason)
        return True
