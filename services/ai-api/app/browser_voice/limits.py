"""Caps and the usage ledger of the browser voice (job DV). A session has a hard length; a workspace has a day's allowance of talking time and of voice characters; a workspace may open only so many sessions a minute and only one at a time.

The ledger lives in this process (Cloud Run may run two instances, so a day's cap can be used up to twice: a limit of the first version, stated in the contract). What is LOGGED per session is numbers and ids only: workspace,
user, session, seconds of speech sent to the recogniser, characters sent to each voice engine, turns. Never audio, never words."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

log = logging.getLogger("app.browser_voice")
IST = timezone(timedelta(hours=5, minutes=30))


@dataclass(frozen=True)
class Limits:
    session_seconds: int = 300
    day_seconds: int = 1800  # a workspace's talking time per day, all its sessions together
    day_tts_chars: int = 6000  # characters sent to the voice engines per workspace per day (Cartesia is paid per character)
    sessions_per_minute: int = 6
    greeting: bool = True


@dataclass
class Usage:
    """One session's numbers."""

    stt_seconds: float = 0.0
    tts_chars: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    turns: int = 0
    ask_turns: int = 0
    interrupts: int = 0
    errors: int = 0

    def chars(self) -> int:
        return sum(self.tts_chars.values())


class Ledger:
    def __init__(self, limits: Limits, *, clock: Callable[[], float] = time.monotonic, today: Callable[[], str] | None = None) -> None:
        self.limits, self._clock = limits, clock
        self._today = today or (lambda: datetime.now(IST).date().isoformat())
        self._lock = threading.Lock()
        self._seconds: dict[tuple[uuid.UUID, str], float] = defaultdict(float)
        self._chars: dict[tuple[uuid.UUID, str], int] = defaultdict(int)
        self._opened: dict[uuid.UUID, deque[float]] = defaultdict(deque)
        self._live: set[uuid.UUID] = set()

    def admit(self, tenant_id: uuid.UUID) -> str | None:
        """None when a new session may start; otherwise the refusal code: busy (one at a time), rate_limited, daily_limit."""
        now = self._clock()
        with self._lock:
            if tenant_id in self._live:
                return "busy"
            opened = self._opened[tenant_id]
            while opened and now - opened[0] > 60:
                opened.popleft()
            if len(opened) >= self.limits.sessions_per_minute:
                return "rate_limited"
            if self._seconds[(tenant_id, self._today())] >= self.limits.day_seconds or self._chars[(tenant_id, self._today())] >= self.limits.day_tts_chars:
                return "daily_limit"
            opened.append(now)
            self._live.add(tenant_id)
        return None

    def release(self, tenant_id: uuid.UUID) -> None:
        with self._lock:
            self._live.discard(tenant_id)

    def add_seconds(self, tenant_id: uuid.UUID, seconds: float) -> None:
        with self._lock:
            self._seconds[(tenant_id, self._today())] += seconds

    def add_chars(self, tenant_id: uuid.UUID, chars: int) -> None:
        with self._lock:
            self._chars[(tenant_id, self._today())] += chars

    def seconds_left(self, tenant_id: uuid.UUID) -> int:
        with self._lock:
            return max(0, int(self.limits.day_seconds - self._seconds[(tenant_id, self._today())]))

    def chars_left(self, tenant_id: uuid.UUID) -> int:
        with self._lock:
            return max(0, self.limits.day_tts_chars - self._chars[(tenant_id, self._today())])


def log_usage(tenant_id: uuid.UUID, user_id: uuid.UUID, session_id: uuid.UUID, seconds: float, usage: Usage, ended: str) -> None:
    """The one line per session that the cost report reads. Ids and numbers only."""
    engines = " ".join(f"chars_{name}={n}" for name, n in sorted(usage.tts_chars.items())) or "chars_none=0"
    log.info(
        "browser_voice_usage tenant=%s user=%s session=%s seconds=%d stt_seconds=%.1f %s turns=%d ask_turns=%d interrupts=%d errors=%d ended=%s",
        tenant_id, user_id, session_id, round(seconds), usage.stt_seconds, engines, usage.turns, usage.ask_turns, usage.interrupts, usage.errors, ended,
    )
