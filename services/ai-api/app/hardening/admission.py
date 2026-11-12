"""Calls first, pages second (Phase 1 of docs/plans/call-capacity-and-instances.md, owner 12 Nov 2026).

One API instance carries a live call (its callbacks, its media socket, its live actions) AND every page of the web app. On 12 Nov 2026 the data layer was slow, page requests waited on it for 10 to 36 seconds, the
instance reached its request limit and refused work with 502. This pure ASGI middleware keeps the call path free whatever the pages and the data layer do:

  1. EXEMPT, never limited, never cached, never refused: `/v1/telephony/*` (the provider callbacks and the media socket), a live call's actions (`/calls/{id}/hang-up`, `/calls/{id}/whisper`), health and metrics. WebSockets are not
     touched at all (Take over is one).
  2. LIMITER: at most `max_inflight` other requests run at once; the next one is answered at once with `503 busy` and `Retry-After: 2`, it never waits. The slot is held until the request has really finished, so the
     threads that run the pages stay below the thread pool and the calls never wait for a thread.
  3. BREAKER: after `breaker_fails` page READS answered 502/503/504 within `breaker_window` seconds, page reads are answered `503 busy` at once for `breaker_open` seconds (writes are not stopped by it).
  4. READ CACHE: the polled and layout reads (`READ_PATHS`) are kept `cache_s` seconds per signed-in caller (a hash of the Authorization header, never the token) and path; any write by that caller drops theirs. Ten tabs are one read.

A setting of 0 switches a part off (`max_inflight=0` = no limiter and no breaker, `cache_s=0` = no cache). Memory only: one process, a restart clears it (like the rate limits). Nothing personal is logged: counts and closed words."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from app.errors import error_body, request_id_of

log = logging.getLogger("app.admission")

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]

EXEMPT_PREFIXES = ("/v1/telephony/", "/health", "/ready", "/metrics")
EXEMPT_CALL_ACTION = re.compile(r"^/v1/tenants/[^/]+/calls/[^/]+/(?:hang-up|whisper)$")
# the reads the layout makes on every page and the polls (the web lane's list of 12 Nov 2026); nothing here is a write, nothing is per-request-private beyond the caller + path (the key)
READ_PATHS = re.compile(
    r"^/v1/(?:me|tenants/[^/]+(?:/(?:today|nav-counts|calls|agents/status|billing/access|billing/usage|billing/entitlements|ai-usage|lead-finder/availability|modules|pack|workspace/profile|me/profile|visits/today))?)$"
)
MAX_ENTRIES = 400
MAX_BODY = 256 * 1024


def is_exempt(path: str) -> bool:
    return path.startswith(EXEMPT_PREFIXES) or bool(EXEMPT_CALL_ACTION.match(path))


class PageGuardMiddleware:
    def __init__(self, app: Any, *, max_inflight: int = 0, cache_s: float = 0.0, breaker_fails: int = 5, breaker_window: float = 10.0, breaker_open: float = 5.0,
                 clock: Callable[[], float] = time.monotonic, on_event: Callable[[str], None] | None = None, internal_token: str = "") -> None:
        self.app = app
        self.max_inflight, self.cache_s = max(0, int(max_inflight)), max(0.0, float(cache_s))
        self.breaker_fails, self.breaker_window, self.breaker_open = breaker_fails, breaker_window, breaker_open
        self._clock, self._on_event = clock, on_event
        self._internal = internal_token.encode() if internal_token else b""   # the private header of the bootstrap's own sub-requests: they are not page requests of their own
        self.inflight = 0
        self._failures: deque[float] = deque()
        self._open_until = 0.0
        self._cache: OrderedDict[tuple[str, str], tuple[float, int, list[tuple[bytes, bytes]], bytes]] = OrderedDict()
        self.stats = {"busy": 0, "breaker": 0, "cache_hit": 0, "cache_store": 0}

    # -- helpers --------------------------------------------------------------------------------------------------------------------------------

    def _event(self, name: str) -> None:
        self.stats[name] = self.stats.get(name, 0) + 1
        if self._on_event is not None:
            self._on_event(name)

    async def _busy(self, scope: Scope, send: Send, why: str) -> None:
        body = json.dumps(error_body("busy", "The service is busy. Try again in a moment.", retry_after=2, request_id=request_id_of(scope))).encode()
        await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"retry-after", b"2"), (b"x-busy", why.encode())]})
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    def _caller(scope: Scope) -> str:
        auth = next((v for k, v in scope["headers"] if k == b"authorization"), b"")
        return hashlib.sha256(auth).hexdigest()[:24] if auth else ""

    def _breaker_open(self) -> bool:
        return self._clock() < self._open_until

    def _note_failure(self) -> None:
        now = self._clock()
        self._failures.append(now)
        while self._failures and now - self._failures[0] > self.breaker_window:
            self._failures.popleft()
        if len(self._failures) >= self.breaker_fails and now >= self._open_until:
            self._open_until = now + self.breaker_open
            self._failures.clear()
            log.warning("admission breaker open: page reads refused for %ss after %s data-layer failures", self.breaker_open, self.breaker_fails)

    def _drop_caller(self, caller: str) -> None:
        for key in [k for k in self._cache if k[0] == caller]:
            del self._cache[key]

    # -- the middleware ---------------------------------------------------------------------------------------------------------------------------

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS" or is_exempt(scope["path"]):
            await self.app(scope, receive, send)
            return
        method, path = scope["method"], scope["path"]
        if self._internal and any(k == b"x-internal-bootstrap" and v == self._internal for k, v in scope["headers"]):
            await self.app(scope, receive, send)
            return
        read = method in ("GET", "HEAD")
        caller = self._caller(scope)
        # a write by a signed-in caller: what was kept for them is dropped
        if self.cache_s and caller and not read:
            self._drop_caller(caller)
        if self.max_inflight and read and self._breaker_open():
            self._event("breaker")
            await self._busy(scope, send, "breaker")
            return
        key = (caller, path + "?" + scope.get("query_string", b"").decode("latin-1"))
        cacheable = bool(self.cache_s and caller and method == "GET" and READ_PATHS.match(path))
        if cacheable:
            hit = self._cache.get(key)
            if hit is not None and self._clock() - hit[0] <= self.cache_s:
                self._event("cache_hit")
                headers = [*hit[2], (b"x-cache", b"hit")]
                await send({"type": "http.response.start", "status": hit[1], "headers": headers})
                await send({"type": "http.response.body", "body": hit[3]})
                return
        if self.max_inflight and self.inflight >= self.max_inflight:
            self._event("busy")
            await self._busy(scope, send, "limit")
            return

        status = 0
        chunks: list[bytes] = []
        start_headers: list[tuple[bytes, bytes]] = []
        size = 0

        async def watch(message: MutableMapping[str, Any]) -> None:
            nonlocal status, size
            if message["type"] == "http.response.start":
                status = int(message["status"])
                start_headers[:] = [(bytes(k), bytes(v)) for k, v in message.get("headers", [])]
            elif message["type"] == "http.response.body" and cacheable:
                size += len(message.get("body", b""))
                if size <= MAX_BODY:
                    chunks.append(message.get("body", b""))
            await send(message)

        self.inflight += 1
        try:
            await self.app(scope, receive, watch)
        finally:
            self.inflight -= 1
        if self.max_inflight and read and status in (502, 503, 504):
            self._note_failure()
        if cacheable and status == 200 and size <= MAX_BODY:
            keep = [(k, v) for k, v in start_headers if k not in (b"x-request-id", b"set-cookie", b"x-cache")]
            self._cache[key] = (self._clock(), 200, keep, b"".join(chunks))
            self._cache.move_to_end(key)
            while len(self._cache) > MAX_ENTRIES:
                self._cache.popitem(last=False)
            self._event("cache_store")
