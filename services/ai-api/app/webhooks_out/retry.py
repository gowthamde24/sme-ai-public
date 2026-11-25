"""The retry schedule: after the 1st failed attempt wait 1 minute, then 5 minutes, 30 minutes, 2 hours, 6 hours; the 6th failure is final (a dead letter). A test event is never retried."""

# ruff: noqa: E501

from __future__ import annotations

BACKOFF_S: tuple[int, ...] = (60, 300, 1800, 7200, 21600)
MAX_ATTEMPTS = len(BACKOFF_S) + 1


def retry_delay(failures: int, event: str = "") -> int | None:
    """Seconds to wait after the `failures`-th failed attempt (1-based), or None: give up (dead letter)."""
    if event == "test.ping" or failures < 1 or failures > len(BACKOFF_S):
        return None
    return BACKOFF_S[failures - 1]
