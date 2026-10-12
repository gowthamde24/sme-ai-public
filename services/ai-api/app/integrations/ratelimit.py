"""A small in-memory sliding-window limiter for the one endpoint that has no sign-in (the calendar feed). It is a best-effort brake that lives in ONE process's memory (like the sign-up limiter): it is
not shared between instances, and a restart clears it. The token itself (256 bits) is what protects the feed; this limits abuse and accidents (a calendar app in a loop, a scan for tokens).
The table is bounded: when it holds too many keys the oldest are dropped."""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable


class SlidingWindow:
    def __init__(self, limit: int, window_seconds: float, *, max_keys: int = 10_000, clock: Callable[[], float] = time.monotonic) -> None:
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        """Count one hit for `key`; False when the key already used its allowance in the window (the refused hit is not counted)."""
        now = self._clock()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                if len(self._hits) >= self.max_keys:
                    self._evict(now)
                q = self._hits[key] = deque()
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def count(self, key: str) -> int:
        """How many hits `key` has in the window now (aged hits are dropped first); counts nothing."""
        now = self._clock()
        with self._lock:
            q = self._hits.get(key)
            if q is None:
                return 0
            while q and now - q[0] >= self.window:
                q.popleft()
            return len(q)

    def retry_after(self, key: str) -> int:
        now = self._clock()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return 1
            return max(1, int(self.window - (now - q[0])) + 1)

    def _evict(self, now: float) -> None:
        for key in [k for k, q in self._hits.items() if not q or now - q[-1] >= self.window]:
            del self._hits[key]
        while len(self._hits) >= self.max_keys:
            del self._hits[next(iter(self._hits))]
