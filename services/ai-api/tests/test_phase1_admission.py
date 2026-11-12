"""Calls first, pages second (Phase 1, docs/plans/call-capacity-and-instances.md; owner 12 Nov 2026): the page limiter, the breaker, the read cache and the short memory of the membership lookup. Pure ASGI, no network."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import uuid
from types import SimpleNamespace
from typing import Any

import pytest

from app.auth import lookup_cache
from app.auth.deps import require_tenant_role
from app.auth.jwt import Principal
from app.errors import ApiError
from app.hardening.admission import PageGuardMiddleware, is_exempt
from tests.test_dv_browser_voice import arun

T = "11111111-1111-1111-1111-111111111111"
TODAY = f"/v1/tenants/{T}/today"


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class App:
    """An ASGI app that can be held open, can fail, and counts what reached it."""

    def __init__(self) -> None:
        self.gate = asyncio.Event()
        self.gate.set()
        self.status = 200
        self.calls = 0

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            self.calls += 1
            return
        self.calls += 1
        await self.gate.wait()
        body = json.dumps({"n": self.calls}).encode()
        await send({"type": "http.response.start", "status": self.status, "headers": [(b"content-type", b"application/json"), (b"x-request-id", b"abc")]})
        await send({"type": "http.response.body", "body": body})


async def call(mw: Any, path: str, *, method: str = "GET", auth: str = "Bearer a", query: str = "") -> tuple[int, dict[bytes, bytes], dict[str, Any]]:
    out: dict[str, Any] = {"headers": {}, "body": b"", "status": 0}

    async def send(message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            out["status"], out["headers"] = message["status"], {k: v for k, v in message["headers"]}
        else:
            out["body"] += message.get("body", b"")

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    headers = [(b"authorization", auth.encode())] if auth else []
    await mw({"type": "http", "method": method, "path": path, "query_string": query.encode(), "headers": headers}, receive, send)
    return out["status"], out["headers"], (json.loads(out["body"]) if out["body"] else {})


def test_the_paths_a_call_needs_are_exempt_and_pages_are_not() -> None:
    for path in ("/v1/telephony/plivo/answer", "/v1/telephony/plivo/stream/abc", "/health", "/metrics", f"/v1/tenants/{T}/calls/{T}/hang-up", f"/v1/tenants/{T}/calls/{T}/whisper"):
        assert is_exempt(path), path
    for path in (TODAY, f"/v1/tenants/{T}/calls", f"/v1/tenants/{T}/calls/{T}", "/v1/me", f"/v1/tenants/{T}/leads"):
        assert not is_exempt(path), path


@arun
async def test_a_page_request_over_the_limit_is_answered_busy_at_once_and_calls_are_never_held_back() -> None:
    app = App()
    app.gate.clear()
    mw = PageGuardMiddleware(app, max_inflight=2)
    held = [asyncio.ensure_future(call(mw, f"/v1/tenants/{T}/leads")) for _ in range(2)]
    await asyncio.sleep(0.05)
    assert mw.inflight == 2
    status, headers, body = await asyncio.wait_for(call(mw, TODAY), 1.0)
    assert status == 503 and headers[b"retry-after"] == b"2" and body["error"]["code"] == "busy" and app.calls == 2, "refused at once, never waited"
    for path in ("/v1/telephony/plivo/outbound-answer", f"/v1/tenants/{T}/calls/{T}/hang-up", "/health"):
        task = asyncio.ensure_future(call(mw, path, method="POST"))
        await asyncio.sleep(0.02)
        assert not task.done() and app.calls >= 3, path   # it reached the app (which is held) instead of being refused
        task.cancel()
    app.gate.set()
    done = await asyncio.gather(*held)
    assert [d[0] for d in done] == [200, 200] and mw.inflight == 0
    assert (await call(mw, TODAY))[0] == 200, "the slots are free again"


@arun
async def test_a_websocket_is_never_touched() -> None:
    app = App()
    mw = PageGuardMiddleware(app, max_inflight=1)
    await mw({"type": "websocket", "path": f"/v1/tenants/{T}/calls/{T}/take-over", "headers": []}, None, None)  # type: ignore[arg-type]
    assert app.calls == 1


@arun
async def test_after_five_failed_page_reads_page_reads_are_refused_for_a_few_seconds_but_writes_and_calls_are_not() -> None:
    app, clock = App(), Clock()
    app.status = 502
    mw = PageGuardMiddleware(app, max_inflight=12, clock=clock)
    for _ in range(5):
        assert (await call(mw, f"/v1/tenants/{T}/leads"))[0] == 502
    status, headers, _ = await call(mw, f"/v1/tenants/{T}/leads")
    assert status == 503 and headers[b"x-busy"] == b"breaker" and app.calls == 5, "refused without asking the data layer"
    app.status = 200
    assert (await call(mw, f"/v1/tenants/{T}/leads", method="POST"))[0] == 200, "a write is not stopped by the breaker"
    assert (await call(mw, "/v1/telephony/plivo/hangup", method="POST"))[0] == 200
    clock.now += 5.1
    assert (await call(mw, f"/v1/tenants/{T}/leads"))[0] == 200, "closed again after the open time"


@arun
async def test_failures_spread_over_more_than_ten_seconds_do_not_open_the_breaker() -> None:
    app, clock = App(), Clock()
    app.status = 503
    mw = PageGuardMiddleware(app, max_inflight=12, clock=clock)
    for _ in range(8):
        await call(mw, f"/v1/tenants/{T}/leads")
        clock.now += 3.0
    assert (await call(mw, f"/v1/tenants/{T}/leads"))[0] == 503 and app.calls == 9, "still asked the app each time"


@arun
async def test_the_polled_reads_are_kept_per_caller_for_a_few_seconds_and_a_write_drops_them() -> None:
    app, clock = App(), Clock()
    mw = PageGuardMiddleware(app, cache_s=3.0, clock=clock)
    first = await call(mw, TODAY)
    second = await call(mw, TODAY)
    assert second[1][b"x-cache"] == b"hit" and second[2] == first[2] and app.calls == 1
    assert b"x-request-id" not in second[1], "the request id of the first answer is not replayed"
    other = await call(mw, TODAY, auth="Bearer b")
    assert b"x-cache" not in other[1] and app.calls == 2, "another caller never gets someone else's answer"
    await call(mw, f"/v1/tenants/{T}/leads", method="POST")   # a write by caller a
    again = await call(mw, TODAY)
    assert b"x-cache" not in again[1] and app.calls == 4
    clock.now += 3.5
    assert b"x-cache" not in (await call(mw, TODAY))[1], "expired"
    anon = await call(mw, TODAY, auth="")
    assert (await call(mw, TODAY, auth=""))[0] == 200 and app.calls >= 6 and b"x-cache" not in anon[1], "no sign-in, no cache"
    not_listed = f"/v1/tenants/{T}/leads"
    await call(mw, not_listed)
    assert b"x-cache" not in (await call(mw, not_listed))[1], "only the listed reads are kept"
    app.status = 500
    await call(mw, f"/v1/tenants/{T}/nav-counts")
    assert b"x-cache" not in (await call(mw, f"/v1/tenants/{T}/nav-counts"))[1], "an error is never kept"


# ---- the short memory of the membership lookup ------------------------------------------------------------------------------------------------------


def _runtime(counter: dict[str, int]) -> Any:
    tenant = SimpleNamespace(id=uuid.UUID(T), name="Shop")
    membership = SimpleNamespace(tenant=tenant, role="owner")

    def get_membership(token: str, user: uuid.UUID, tenant_id: uuid.UUID) -> Any:
        counter["membership"] += 1
        return membership

    def check(integrations: Any, token: str, user: str) -> None:
        counter["policy"] += 1

    return SimpleNamespace(repository=SimpleNamespace(get_membership=get_membership), billing=None, policy_gate=SimpleNamespace(check=check), integrations=None)


def _request(method: str) -> Any:
    return SimpleNamespace(method=method, url=SimpleNamespace(path=f"/v1/tenants/{T}/today"))


def test_a_read_remembers_the_membership_and_the_terms_check_but_a_write_and_a_second_factor_action_always_ask() -> None:
    counter = {"membership": 0, "policy": 0}
    runtime = _runtime(counter)
    principal = Principal(user_id=uuid.uuid4(), token="t")
    lookup_cache.configure(membership_s=15, policy_s=60)
    try:
        dep = require_tenant_role()
        for _ in range(5):
            dep(tenant_id=T, request=_request("GET"), principal=principal, runtime=runtime)
        assert counter == {"membership": 1, "policy": 1}, "five reads, one lookup of each"
        dep(tenant_id=T, request=_request("POST"), principal=principal, runtime=runtime)
        assert counter == {"membership": 2, "policy": 2}, "a write asks the database"
        strong = require_tenant_role(strong=True)
        strong(tenant_id=T, request=_request("GET"), principal=Principal(user_id=principal.user_id, token="t", aal="aal2"), runtime=runtime)
        assert counter["membership"] == 3, "a second-factor action asks the database"
        other = Principal(user_id=uuid.uuid4(), token="t2")
        dep(tenant_id=T, request=_request("GET"), principal=other, runtime=runtime)
        assert counter["membership"] == 4, "another person is another lookup"
    finally:
        lookup_cache.configure(membership_s=0, policy_s=0)


def test_with_the_memory_off_every_request_asks_and_a_missing_membership_is_never_kept() -> None:
    counter = {"membership": 0, "policy": 0}
    runtime = _runtime(counter)
    principal = Principal(user_id=uuid.uuid4(), token="t")
    dep = require_tenant_role()
    for _ in range(3):
        dep(tenant_id=T, request=_request("GET"), principal=principal, runtime=runtime)
    assert counter == {"membership": 3, "policy": 3}
    lookup_cache.configure(membership_s=15, policy_s=60)
    try:
        runtime.repository.get_membership = lambda *a: None
        for _ in range(2):
            with pytest.raises(ApiError):
                dep(tenant_id=T, request=_request("GET"), principal=principal, runtime=runtime)
        runtime.repository.get_membership = _runtime(counter).repository.get_membership
        dep(tenant_id=T, request=_request("GET"), principal=principal, runtime=runtime)   # becomes a member: seen at once
    finally:
        lookup_cache.configure(membership_s=0, policy_s=0)


# ---- 12 Nov 2026: a short wait in front of the busy answer ------------------------------------------------------------------------------------------


class SlowApp:
    """An app that answers after `delay` seconds, so a burst really overlaps."""

    def __init__(self, delay: float) -> None:
        self.delay, self.running, self.peak = delay, 0, 0

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        self.running += 1
        self.peak = max(self.peak, self.running)
        try:
            await asyncio.sleep(self.delay)
        finally:
            self.running -= 1
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": b"{}"})


@arun
async def test_a_burst_of_thirty_reads_is_absorbed_by_a_short_wait_and_never_runs_more_than_the_limit_at_once() -> None:
    app = SlowApp(0.05)
    mw = PageGuardMiddleware(app, max_inflight=12, queue_wait_s=1.0, queue_max=60)
    results = await asyncio.gather(*(call(mw, f"/v1/tenants/{T}/leads", auth=f"Bearer u{i}") for i in range(30)))
    assert [r[0] for r in results] == [200] * 30, "the Today page of 12 Nov: 36 of its reads got 503; now they wait their turn"
    assert app.peak <= 12 and mw.inflight == 0 and mw.stats["queued"] == 18


@arun
async def test_a_request_that_waits_longer_than_the_limit_or_finds_the_line_full_is_refused_and_the_slots_are_all_returned() -> None:
    app = SlowApp(0.6)
    mw = PageGuardMiddleware(app, max_inflight=2, queue_wait_s=0.2, queue_max=1)
    tasks = [asyncio.ensure_future(call(mw, f"/v1/tenants/{T}/leads", auth=f"Bearer u{i}")) for i in range(4)]
    done = await asyncio.gather(*tasks)
    codes = sorted(d[0] for d in done)
    assert codes == [200, 200, 503, 503], codes   # two run, one waits and times out after 0.2 s, one finds the line full
    assert mw.inflight == 0 and mw._waiting == 0   # noqa: SLF001
    assert (await call(mw, f"/v1/tenants/{T}/leads"))[0] == 200, "no slot leaked"


@arun
async def test_with_no_wait_set_the_limit_still_refuses_at_once() -> None:
    app = SlowApp(0.3)
    mw = PageGuardMiddleware(app, max_inflight=1)
    first = asyncio.ensure_future(call(mw, f"/v1/tenants/{T}/leads"))
    await asyncio.sleep(0.02)
    assert (await asyncio.wait_for(call(mw, f"/v1/tenants/{T}/leads"), 0.1))[0] == 503
    assert (await first)[0] == 200
