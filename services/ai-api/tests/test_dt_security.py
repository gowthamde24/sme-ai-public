"""Job DT, security audit: the origin lock, replay protection, per-account allowances and the HSTS header."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
from typing import Any

from app.hardening.headers import api_headers
from app.hardening.originlock import OriginLockMiddleware, origin_ok
from app.hardening.ratelimit import RateLimiter, account_rule
from app.hardening.replay import FRESH_SECONDS, ReplayGuard


async def _ok_app(scope: Any, receive: Any, send: Any) -> None:
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


def call(app: Any, path: str, headers: list[tuple[bytes, bytes]] | None = None) -> int:
    sent: list[dict[str, Any]] = []

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b""}

    asyncio.run(app({"type": "http", "path": path, "method": "GET", "headers": headers or []}, receive, send))
    return int(sent[0]["status"])


def test_without_a_secret_nothing_is_locked() -> None:
    app = OriginLockMiddleware(_ok_app, secret=None)
    assert call(app, "/v1/packs") == 200


def test_with_a_secret_only_a_request_that_carries_it_gets_through_and_the_probes_are_exempt() -> None:
    app = OriginLockMiddleware(_ok_app, secret="s3cret-value")
    assert call(app, "/v1/packs") == 403
    assert call(app, "/v1/packs", [(b"x-stack19-origin", b"wrong")]) == 403
    assert call(app, "/v1/packs", [(b"x-stack19-origin", b"s3cret-value")]) == 200
    assert call(app, "/health") == 200 and call(app, "/ready") == 200
    assert origin_ok(None, "x") is False and origin_ok(b"x", "x") is True


def test_a_signed_call_is_refused_when_stale_replayed_or_malformed_and_an_unsigned_one_is_accepted() -> None:
    now = [1_800_000_000.0]
    guard = ReplayGuard(clock=lambda: now[0])
    ts = str(int(now[0]))
    assert guard.check(None, None) is None
    assert guard.check(ts, "nonce-0001-abcd") is None
    assert guard.check(ts, "nonce-0001-abcd") == "replayed"
    assert guard.check(str(int(now[0]) - FRESH_SECONDS - 1), "nonce-0002-abcd") == "stale"
    assert guard.check(ts, None) == "bad_headers" and guard.check(None, "nonce-0003-abcd") == "bad_headers"
    assert guard.check("12x", "nonce-0004-abcd") == "bad_headers" and guard.check(ts, "short") == "bad_headers"
    now[0] += FRESH_SECONDS + 5
    assert guard.check(str(int(now[0])), "nonce-0001-abcd") is None, "after the window the same nonce is new (the timestamp is what protects then)"


def test_the_expensive_routes_have_an_allowance_per_account() -> None:
    clock = [0.0]
    limiter = RateLimiter(clock=lambda: clock[0])
    path = "/v1/tenants/x/tasks/plan"
    results = [limiter.check(path, "1.1.1.1", "Bearer a", "POST") for _ in range(11)]
    assert results[:10] == [None] * 10 and results[10] is not None and results[10][0] == "task_plan"
    assert limiter.check(path, "1.1.1.1", "Bearer b", "POST") is None, "another account has its own allowance"
    assert limiter.check(path, "1.1.1.1", "Bearer a", "GET") is None, "a read of the list is not a plan"
    assert account_rule("/v1/tenants/x/lead-imports/preview", "POST") is not None and account_rule("/v1/tenants/x/leads", "POST") is None
    assert account_rule("/v1/tenants/x/ai-assistant/voice-preview", "GET") is not None


def test_hsts_is_preload_ready_in_production_only() -> None:
    prod = dict(api_headers(True, False))
    assert prod[b"strict-transport-security"] == b"max-age=63072000; includeSubDomains; preload"
    assert b"strict-transport-security" not in dict(api_headers(False, False))
