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
import re
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
    PublicRule("calculate_materials", "/v1/calculate/materials", True, 30),  # job CN: the public paver calculator (pure; no business data)
    PublicRule("privacy_notice", "/v1/privacy/notice", True, 60),  # job DQ: the privacy notice facts
    PublicRule("subprocessors", "/v1/privacy/subprocessors", True, 60),
    PublicRule("grievance", "/v1/privacy/grievance", True, 6),  # a person filing a grievance (the hour's allowance is in the route)
    PublicRule("waitlist", "/v1/public/waitlist", True, 6),
    PublicRule("lead_templates", "/v1/lead-templates", False, 60),  # job DR / A1: the nine business types and their templates (static data)
    PublicRule("lead_intake", "/v1/lead-intake/", False, 60),  # job DR / A2: a website form, a webhook, a portal's mail, Meta (the secret address is the credential; the database holds its own caps)
    PublicRule("webhooks", "/v1/webhooks/", False, 300),
    PublicRule("voice_samples", "/v1/voice-samples/", False, 120),  # job voice-picker: the pre-rendered samples (static files, no data)
    PublicRule("docs", "/docs", False, 20),
    PublicRule("redoc", "/redoc", False, 20),
    PublicRule("openapi", "/openapi.json", True, 20),
)


@dataclass(frozen=True)
class AccountRule:
    """A per-ACCOUNT allowance (a hash of the bearer token) for a route that spends money or work: the voice preview, Ask, a task plan, an import (job DT, security audit)."""

    name: str
    pattern: re.Pattern[str]
    limit: int  # per minute per account


ACCOUNT_RULES: tuple[AccountRule, ...] = (
    AccountRule("voice_preview", re.compile(r"/ai-assistant/(voice-(preview|sample)|voices/preview)"), 12),
    AccountRule("ask", re.compile(r"/assistant/messages$"), 20),
    AccountRule("task_plan", re.compile(r"/tasks/plan$"), 10),
    AccountRule("imports", re.compile(r"/lead-imports(/read|/preview)?$"), 20),
    AccountRule("uploads", re.compile(r"/(workspace/logo|me/picture)$"), 10),
)


def account_rule(path: str, method: str) -> AccountRule | None:
    if method != "POST" and not path.endswith(("voice-preview", "voice-sample", "voices/preview")):
        return None
    for rule in ACCOUNT_RULES:
        if rule.pattern.search(path):
            return rule
    return None


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
        self._account = {rule.name: SlidingWindow(rule.limit, 60.0, **kw) for rule in ACCOUNT_RULES}

    def check(self, path: str, ip: str, authorization: str | None, method: str = "GET") -> tuple[str, int] | None:
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
            account = account_rule(path, method)
            if account is not None:
                window = self._account[account.name]
                if not window.allow(f"{account.name}:{key}"):
                    return account.name, window.retry_after(f"{account.name}:{key}")
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
        refused = self.limiter.check(scope["path"], ip, auth, scope["method"])
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
