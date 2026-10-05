"""Time and politeness limits: a wall-clock deadline per fetch, per-host spacing, daily caps."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Callable

from app.agents.web import FetchError


class Deadline:
    """A TOTAL wall-clock budget. Per-read timeouts alone let a server that sends one byte every
    few seconds hold a worker forever; this covers DNS, connect, TLS, headers, body, redirects."""

    def __init__(self, seconds: float) -> None:
        self._end = time.monotonic() + seconds

    def exceeded(self) -> bool:
        return time.monotonic() >= self._end

    def remaining(self) -> float:
        left = self._end - time.monotonic()
        if left <= 0:
            raise FetchError("timeout")
        return left


class HostLimiter:
    """At least `min_interval` seconds between two requests to one host, and at most `daily_cap`
    pages per host in any 24 hours. The clock and the sleep are injected so tests do not wait."""

    def __init__(
        self,
        *,
        min_interval: float,
        daily_cap: int,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        wall: Callable[[], float] = time.time,
    ) -> None:
        self._min_interval = min_interval
        self._daily_cap = daily_cap
        self._clock = clock
        self._sleep = sleep
        self._wall = wall
        self._last: dict[str, float] = {}
        self._pages: defaultdict[str, deque[float]] = defaultdict(deque)

    def acquire(self, host: str, deadline: Deadline, *, extra_delay: float = 0.0) -> None:
        interval = max(self._min_interval, extra_delay)
        last = self._last.get(host)
        if last is not None:
            wait = interval - (self._clock() - last)
            if wait > 0:
                if wait > deadline.remaining():
                    raise FetchError("rate_limited")
                self._sleep(wait)
        self._last[host] = self._clock()

    def check_daily(self, host: str) -> None:
        pages = self._pages[host]
        cutoff = self._wall() - 86400
        while pages and pages[0] <= cutoff:
            pages.popleft()
        if len(pages) >= self._daily_cap:
            raise FetchError("daily_limit")

    def record_page(self, host: str) -> None:
        self._pages[host].append(self._wall())
