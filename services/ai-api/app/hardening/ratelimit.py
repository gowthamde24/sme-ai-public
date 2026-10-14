"""Rate limits on every route (job CB, ADR 0082): a pure ASGI middleware, one process's memory (like the other limiters here: a restart clears it and two instances do not share it; a shared store is a
hosting decision, `docs/runbooks/hardening.md`). Three layers:

  1. PUBLIC routes (no sign-in: health, readiness, metrics, the policies, the calendar feed, the webhooks, the documentation) each have their own allowance per caller address.
  2. Every other route: an allowance per bearer token (a hash of the header, never the token) so one runaway client cannot hold the service.
  3. SLOW DOWN after repeated failures: an address that collected FAIL_LIMIT 401 answers in FAIL_WINDOW seconds is held to SUSPECT_LIMIT requests a minute for as long as that count stands (token guessing becomes slow;
     a shared office address is slowed, never locked out).

A refused request is a plain 429 with Retry-After and the same JSON error as every other refusal; nothing about the caller is in it. CORS preflights (OPTIONS) are not counted."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable, MutableMapping
from dataclasses import dataclass
from typing import Any

from app.errors import error_body, request_id_of
from app.hardening.clientip import client_ip, short_hash
from app.integrations.ratelimit import SlidingWindow

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]

FAIL_LIMIT, FAIL_WINDOW = 30, 300.0
SUSPECT_LIMIT = 20
TOKEN_LIMIT = 1200  # a minute: twenty requests a second for one signed-in client is far more than a screen needs


@dataclass(frozen=True)
class PublicRule:
    name: str
    prefix: str
    exact: bool
    limit: int  # per minute per caller address


# the routes that need no sign-in. A new public route must be added here (a test lists every route without a sign-in and fails for one that is not).
PUBLIC_RULES: tuple[PublicRule, ...] = (
    PublicRule("health", "/health", True, 120),
    PublicRule("ready", "/ready", True, 30),
    PublicRule("metrics", "/metrics", True, 30),
    PublicRule("policies", "/v1/policies/current", True, 60),
    PublicRule("calendar_feed", "/v1/calendar/feed/", False, 30),
    PublicRule("push_key", "/v1/push/public-key", True, 60),
    PublicRule("packs", "/v1/packs", True, 60),  # job CK: the sign-up cards
    PublicRule("auth_providers", "/v1/auth/providers", True, 60),  # job CK: which sign-up buttons to show
    PublicRule("webhooks", "/v1/webhooks/", False, 300),
    PublicRule("docs", "/docs", False, 20),
    PublicRule("redoc", "/redoc", False, 20),
    PublicRule("openapi", "/openapi.json", True, 20),
)


def public_rule(path: str) -> PublicRule | None:
    for rule in PUBLIC_RULES:
        if (path == rule.prefix) if rule.exact else path.startswith(rule.prefix):
            return rule
    return None


class RateLimiter:
    """The counters; the middleware below is a thin wrapper, so a test can drive the rules with a fake clock."""

    def __init__(self, *, clock: Callable[[], float] | None = None) -> None:
        kw: dict[str, Any] = {"clock": clock} if clock is not None else {}
        self._public = {rule.name: SlidingWindow(rule.limit, 60.0, **kw) for rule in PUBLIC_RULES}
        self._token = SlidingWindow(TOKEN_LIMIT, 60.0, **kw)
        self._failures = SlidingWindow(FAIL_LIMIT, FAIL_WINDOW, **kw)
        self._suspect = SlidingWindow(SUSPECT_LIMIT, 60.0, **kw)

    def check(self, path: str, ip: str, authorization: str | None) -> tuple[str, int] | None:
        """None when the request may go; else (the name of the rule that refused it, seconds to wait)."""
        rule = public_rule(path)
        if rule is not None:
            key = f"{rule.name}:{ip}"
            window = self._public[rule.name]
            if not window.allow(key):
                return rule.name, window.retry_after(key)
            return None
        if self._is_suspect(ip):
            key = f"suspect:{ip}"
            if not self._suspect.allow(key):
                return "slow_down", self._suspect.retry_after(key)
        if authorization:
            key = hashlib.sha256(authorization.encode()).hexdigest()[:24]
            if not self._token.allow(key):
                return "token", self._token.retry_after(key)
        return None

    def failed(self, ip: str) -> None:
        """A sign-in failure (401) from this address (counted up to FAIL_LIMIT; past it the address is already slowed)."""
        self._failures.allow(f"fail:{ip}")

    def _is_suspect(self, ip: str) -> bool:
        # the failures window holds at most FAIL_LIMIT entries: when it is full the address is slowed until the oldest of them ages out
        return self._failures.count(f"fail:{ip}") >= FAIL_LIMIT


class RateLimitMiddleware:
    def __init__(self, app: Any, *, limiter: RateLimiter | None = None, trusted_hops: int = 0, on_limited: Callable[[str], None] | None = None) -> None:
        self.app = app
        self.limiter = limiter or RateLimiter()
        self.hops = trusted_hops
        self.on_limited = on_limited

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return
        ip = client_ip(scope, self.hops)
        auth = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"authorization"), None)
        refused = self.limiter.check(scope["path"], ip, auth)
        if refused is not None:
            rule, wait = refused
            if self.on_limited is not None:
                self.on_limited(rule)
            body = json.dumps(error_body("rate_limited", f"Too many requests. Try again in {wait} seconds.", retry_after=wait, request_id=request_id_of(scope))).encode()
            await send({"type": "http.response.start", "status": 429, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"retry-after", str(wait).encode())]})
            await send({"type": "http.response.body", "body": body})
            return

        async def watch(message: MutableMapping[str, Any]) -> None:
            if message["type"] == "http.response.start" and message["status"] == 401:
                self.limiter.failed(ip)
            await send(message)

        await self.app(scope, receive, watch)


def caller_tag(ip: str) -> str:
    return short_hash(ip)
