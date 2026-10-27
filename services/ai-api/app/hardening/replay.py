"""Replay protection for the doors that take a call from outside (job DT, security audit). A sender that can sign its call adds `X-Stack19-Timestamp` (epoch seconds) and `X-Stack19-Nonce`: a call whose
timestamp is more than FRESH_SECONDS away from now, or whose nonce was already seen inside that window, is refused (409 `replay`). A call with neither header is accepted as before (a plain website form
cannot sign); the secret address stays the credential. Meta and WhatsApp calls are signed by Meta and cannot carry these headers: they are protected by that signature plus the de-duplication of their own ids.
One process's memory, like the other limiters: a restart or a second instance forgets the nonces, which only matters inside a five-minute window."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

FRESH_SECONDS = 300
MAX_NONCES = 50_000


class ReplayGuard:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def check(self, timestamp: str | None, nonce: str | None) -> str | None:
        """None when the call may go; else a closed word: `bad_headers` (one without the other, or not well formed), `stale`, `replayed`."""
        if timestamp is None and nonce is None:
            return None
        if timestamp is None or nonce is None or not timestamp.isdigit() or len(timestamp) > 12 or not (8 <= len(nonce) <= 80) or not nonce.isascii() or not nonce.isprintable():
            return "bad_headers"
        now = self._clock()
        if abs(now - int(timestamp)) > FRESH_SECONDS:
            return "stale"
        with self._lock:
            if len(self._seen) > MAX_NONCES:
                self._seen = {n: t for n, t in self._seen.items() if now - t <= FRESH_SECONDS}
            if nonce in self._seen and now - self._seen[nonce] <= FRESH_SECONDS:
                return "replayed"
            self._seen[nonce] = now
        return None
