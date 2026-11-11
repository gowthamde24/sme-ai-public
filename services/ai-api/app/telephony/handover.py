"""The hand-over of what a Lead Desk task call learned (job: write structured call answers back, 11 Nov 2026), from the call session to the dialer that waits for the call to end. Neutral on purpose: the session
(call_session.py) puts, the Plivo task dialer (plivo_tasks.py) takes, and neither imports the other."""

# ruff: noqa: E501

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from typing import Any


class FinishedCalls:
    """What a Lead Desk task call learned (its checked answers, one-line summary, outcome and transcript), kept in memory (one server) from the end of the call until the dialer that waits for it takes it, once.
    The call's own record (summary, transcript) is in the database as for any call; this is only the hand-over to the task's person row, and it holds PII for a few minutes, never in a log."""

    def __init__(self, ttl_s: float = 600.0, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl, self._clock = ttl_s, clock
        self._items: dict[uuid.UUID, tuple[float, Any]] = {}

    def put(self, call_id: uuid.UUID, outcome: Any) -> None:
        now = self._clock()
        for key in [k for k, (at, _) in self._items.items() if now - at > self._ttl]:
            del self._items[key]
        self._items[call_id] = (now, outcome)

    def take(self, call_id: uuid.UUID) -> Any | None:
        item = self._items.pop(call_id, None)
        return item[1] if item is not None and self._clock() - item[0] <= self._ttl else None


FINISHED = FinishedCalls()
