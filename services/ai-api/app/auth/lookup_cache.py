"""A tiny time-to-live memory for the two lookups every signed-in request repeats (Phase 1 of docs/plans/call-capacity-and-instances.md, owner 12 Nov 2026): who the caller is in the workspace (their membership) and whether
they have accepted the current terms and privacy notice. One page load made about 12 requests, each asking the database both. Used for READS only: a write (and any action that needs the second factor) always asks the
database. A change of role or removal from a workspace shows within MEMBERSHIP seconds on reads; an accepted-terms result is kept POLICY seconds. 0 = off (the default; the deployment sets the seconds). One process's memory;
nothing is stored beyond the lookup's own small result, and a failed or negative result is never kept."""

# ruff: noqa: E501

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any


class TtlCache:
    def __init__(self, ttl: float = 0.0, *, max_entries: int = 2000, clock: Callable[[], float] = time.monotonic) -> None:
        self.ttl, self.max_entries, self._clock = max(0.0, float(ttl)), max_entries, clock
        self._items: OrderedDict[Any, tuple[float, Any]] = OrderedDict()
        self.hits = 0

    def get(self, key: Any) -> Any | None:
        if not self.ttl:
            return None
        item = self._items.get(key)
        if item is None or self._clock() - item[0] > self.ttl:
            self._items.pop(key, None)
            return None
        self.hits += 1
        return item[1]

    def put(self, key: Any, value: Any) -> None:
        if not self.ttl or value is None:
            return
        self._items[key] = (self._clock(), value)
        self._items.move_to_end(key)
        while len(self._items) > self.max_entries:
            self._items.popitem(last=False)

    def clear(self) -> None:
        self._items.clear()


MEMBERSHIP = TtlCache()
POLICY = TtlCache()


def configure(*, membership_s: float, policy_s: float) -> None:
    MEMBERSHIP.ttl, POLICY.ttl = max(0.0, float(membership_s)), max(0.0, float(policy_s))
    MEMBERSHIP.clear()
    POLICY.clear()
