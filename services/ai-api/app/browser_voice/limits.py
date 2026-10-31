"""Caps and the usage ledger of the browser voice (job DV). A session has a hard length; a workspace has a day's allowance of talking time and of voice characters; a workspace may open only so many sessions a minute and only one at a time.

The day's numbers are DURABLE when a store is given (follow-up, migration 20261213090000): they are read from the database when a session is admitted, and the session's new seconds and characters are written back every few seconds
and when it ends, so two API instances and a restart share one count. The count in memory is the database's last answer plus what this process has not written yet; if the database cannot be reached the memory count carries on and the
unwritten numbers are kept for the next try. What is LOGGED per session is numbers and ids only: workspace, user, session, seconds of speech sent to the recogniser, characters sent to each voice engine, turns. Never audio, never words."""

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

from app.browser_voice.store import UsageStore

log = logging.getLogger("app.browser_voice")
IST = timezone(timedelta(hours=5, minutes=30))


@dataclass(frozen=True)
class Limits:
    session_seconds: int = 3600   # the owner's chat stays open until they close it (an hour at most per session)
    day_seconds: int = 7200  # a workspace's talking time per day, all its sessions together
    day_tts_chars: int = 12000  # characters sent to the voice engines per workspace per day (Cartesia is paid per character)
    sessions_per_minute: int = 6
    greeting: bool = True
    semantic_turns: bool = True   # live conversation standard A1/A2: an unfinished thought is not answered; the speaker's own pause sets the quiet that ends a turn
    audio_ahead_ms: int = 300     # standard B1: the server sends no more than this much audio ahead of what the browser has played, so a stop is not queued behind it (0: as fast as it is made)
    speculative: bool = True      # standard A3: the fast tier starts on a stable, finished-looking partial transcript; kept when the final transcript is the same words, dropped when the caller goes on
    filler_after_ms: int = 1800   # a data or action turn gets a "one moment" filler only if its answer audio has not started by then (owner, 31 Oct 2026)
    filler_on_casual: bool = False  # small talk never gets one
    audio_turn: str = "shadow"    # the audio turn model: off | shadow | on (see Settings.browser_voice_audio_turn)
    audio_turn_model: str = ""    # path of the ONNX file ("": none); a missing file or a failed load means the text rules alone
    command_wait_ms: int = 900    # a finished-looking command (send, call, remind ... in Telugu, English, Kannada) waits this long for its quantity or name; 0: off. Questions and chat never wait (owner, 31 Oct 2026)
    verify_barge_in: bool = True  # standard B1/B2: a sound while the assistant speaks pauses it; a cough, a "hmm" or a TV lets it go on (a real interruption stops it)


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
    def __init__(self, limits: Limits, store: UsageStore | None = None, *, clock: Callable[[], float] = time.monotonic, today: Callable[[], str] | None = None) -> None:
        self.limits, self._store, self._clock = limits, store, clock
        self._today = today or (lambda: datetime.now(IST).date().isoformat())
        self._lock = threading.Lock()
        self._seconds: dict[tuple[uuid.UUID, str], float] = defaultdict(float)  # the day's total: the database's last answer plus what is not written yet
        self._chars: dict[tuple[uuid.UUID, str], int] = defaultdict(int)
        self._pending: dict[tuple[uuid.UUID, str], list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])  # seconds, chars, sessions not yet written
        self._opened: dict[uuid.UUID, deque[float]] = defaultdict(deque)
        self._live: set[uuid.UUID] = set()

    # ---- the database ---------------------------------------------------------------------------------------------------------------------------

    def _merge(self, key: tuple[uuid.UUID, str], answer: dict[str, object]) -> None:
        """The database's totals for the day, plus what this process still has to write."""
        pend = self._pending[key]
        self._seconds[key] = float(answer.get("seconds") or 0) + pend[0]  # type: ignore[arg-type]
        self._chars[key] = int(answer.get("tts_chars") or 0) + int(pend[1])  # type: ignore[call-overload]

    def sync(self, tenant_id: uuid.UUID, token: str) -> None:
        """Read today's numbers (blocking: call it from a thread). A database that cannot answer changes nothing."""
        if self._store is None:
            return
        key = (tenant_id, self._today())
        try:
            answer = self._store.get(token, tenant_id)
        except Exception as err:  # noqa: BLE001 - only the class is kept
            log.warning("browser_voice_usage_read_failed code=%s", err.__class__.__name__)
            return
        with self._lock:
            self._merge(key, answer)

    def flush(self, tenant_id: uuid.UUID, token: str) -> None:
        """Write what has not been written yet (blocking). Each call to the database is bounded, so a long backlog goes in pieces; a failure keeps the rest for the next try."""
        if self._store is None:
            return
        key = (tenant_id, self._today())
        while True:
            with self._lock:
                seconds, chars, sessions = self._pending[key]
                if seconds < 1 and chars < 1 and sessions < 1:
                    return
                take = (min(int(seconds), 600), min(int(chars), 6000), min(int(sessions), 1))
            try:
                answer = self._store.add(token, tenant_id, *take)
            except Exception as err:  # noqa: BLE001
                log.warning("browser_voice_usage_write_failed code=%s", err.__class__.__name__)
                return
            with self._lock:
                pend = self._pending[key]
                pend[0] -= take[0]
                pend[1] -= take[1]
                pend[2] -= take[2]
                self._merge(key, answer)

    # ---- admission and counting -----------------------------------------------------------------------------------------------------------------

    def admit(self, tenant_id: uuid.UUID, token: str | None = None) -> str | None:
        """None when a new session may start; otherwise the refusal code: busy (one at a time), rate_limited, daily_limit. With a token the day's numbers are read from the database first (blocking: call it from a thread)."""
        if token is not None:
            self.sync(tenant_id, token)
        now = self._clock()
        with self._lock:
            if tenant_id in self._live:
                return "busy"
            opened = self._opened[tenant_id]
            while opened and now - opened[0] > 60:
                opened.popleft()
            if len(opened) >= self.limits.sessions_per_minute:
                return "rate_limited"
            key = (tenant_id, self._today())
            if self._seconds[key] >= self.limits.day_seconds or self._chars[key] >= self.limits.day_tts_chars:
                return "daily_limit"
            opened.append(now)
            self._live.add(tenant_id)
            self._pending[key][2] += 1
        return None

    def release(self, tenant_id: uuid.UUID) -> None:
        with self._lock:
            self._live.discard(tenant_id)

    def add_seconds(self, tenant_id: uuid.UUID, seconds: float) -> None:
        key = (tenant_id, self._today())
        with self._lock:
            self._seconds[key] += seconds
            self._pending[key][0] += seconds

    def add_chars(self, tenant_id: uuid.UUID, chars: int) -> None:
        key = (tenant_id, self._today())
        with self._lock:
            self._chars[key] += chars
            self._pending[key][1] += chars

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
