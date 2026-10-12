"""Job CB (ADR 0082): the hardening layer. Rate limits on every public route and per token, the slow-down after repeated sign-in failures, security headers, the request size ceiling, the request id, the
structured access line (no personal data), the log scrubber, readiness, the metrics page, the documentation switch and CORS. No network, no database."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.hardening import ratelimit
from app.hardening.clientip import client_ip, short_hash
from app.hardening.headers import SecurityHeadersMiddleware
from app.hardening.observe import JsonFormatter, Metrics, ScrubFilter, install_logging, scrub
from app.hardening.ratelimit import (
    FAIL_LIMIT,
    PUBLIC_RULES,
    SUSPECT_LIMIT,
    TOKEN_LIMIT,
    RateLimiter,
    public_rule,
)
from app.main import create_app
from app.tenancy.repository import PostgrestTenantRepository
from tests.fakes import TENANT_A, auth, make_client


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


# ---------------------------------------------------------------------------------------------- every public route has a rate rule
def _routes(app: Any) -> list[tuple[str, str, list[str]]]:
    def names(dep: Any, out: set[str]) -> None:
        for sub in dep.dependencies:
            out.add(getattr(sub.call, "__qualname__", str(sub.call)))
            names(sub, out)

    found: list[tuple[str, str, list[str]]] = []
    for route in app.routes:
        contexts = list(route.effective_route_contexts()) if type(route).__name__ == "_IncludedRouter" else [route] if hasattr(route, "dependant") else []
        for c in contexts:
            deps: set[str] = set()
            names(c.dependant, deps)
            found.append((",".join(sorted(c.methods)), c.path, sorted(deps)))
    return found


def test_every_route_without_a_sign_in_has_a_rate_rule_and_is_on_the_known_list() -> None:
    client, _ = make_client()
    public = sorted(path for _, path, deps in _routes(client.app) if not any("get_principal" in d or d.endswith("dependency") for d in deps))
    # a NEW public route fails this test until it is listed here AND has a rule in app/hardening/ratelimit.py (and its path word in logging_safety.ROUTE_WORDS)
    known = {"/health", "/ready", "/v1/calendar/feed/{token_ics}", "/v1/policies/current"}
    metrics_route = {"/metrics"}
    assert set(public) - metrics_route == known, public
    for path in public:
        concrete = path.replace("{token_ics}", "abc.ics")
        assert public_rule(concrete) is not None, f"{path} has no rate rule"


def test_the_rules_are_well_formed() -> None:
    assert len({r.name for r in PUBLIC_RULES}) == len(PUBLIC_RULES)
    assert public_rule("/health").name == "health"  # type: ignore[union-attr]
    assert public_rule("/health/extra") is None and public_rule("/v1/tenants/x/orders") is None
    assert public_rule("/v1/webhooks/razorpay").name == "webhooks"  # type: ignore[union-attr]
    assert public_rule("/v1/calendar/feed/abc.ics").name == "calendar_feed"  # type: ignore[union-attr]


# ---------------------------------------------------------------------------------------------- the limiter
def test_a_public_route_allows_its_limit_then_refuses_with_a_wait() -> None:
    clock = Clock()
    limiter = RateLimiter(clock=clock)
    rule = public_rule("/ready")
    assert rule is not None
    for _ in range(rule.limit):
        assert limiter.check("/ready", "1.2.3.4", None) is None
    refused = limiter.check("/ready", "1.2.3.4", None)
    assert refused is not None and refused[0] == "ready" and 1 <= refused[1] <= 61
    assert limiter.check("/ready", "5.6.7.8", None) is None, "another caller has its own allowance"
    assert limiter.check("/health", "1.2.3.4", None) is None, "and so does another route"
    clock.now += 61
    assert limiter.check("/ready", "1.2.3.4", None) is None, "a minute later it is allowed again"


def test_a_signed_in_client_has_a_per_token_allowance() -> None:
    limiter = RateLimiter(clock=Clock())
    for _ in range(TOKEN_LIMIT):
        assert limiter.check("/v1/me", "1.1.1.1", "Bearer aaa") is None
    refused = limiter.check("/v1/me", "1.1.1.1", "Bearer aaa")
    assert refused is not None and refused[0] == "token"
    assert limiter.check("/v1/me", "1.1.1.1", "Bearer bbb") is None, "another token is not affected"
    assert limiter.check("/v1/me", "1.1.1.1", None) is None, "no token: the slow-down rule is the only brake"


def test_repeated_sign_in_failures_slow_an_address_down_without_locking_it_out() -> None:
    clock = Clock()
    limiter = RateLimiter(clock=clock)
    for _ in range(FAIL_LIMIT - 1):
        limiter.failed("9.9.9.9")
    assert all(limiter.check("/v1/me", "9.9.9.9", "Bearer x") is None for _ in range(5)), "below the limit nothing changes"
    limiter.failed("9.9.9.9")
    allowed = sum(1 for _ in range(SUSPECT_LIMIT + 10) if limiter.check("/v1/me", "9.9.9.9", "Bearer x") is None)
    assert allowed == SUSPECT_LIMIT, "a slowed address still gets its twenty a minute"
    assert limiter.check("/v1/me", "8.8.8.8", "Bearer x") is None, "another address is unaffected"
    clock.now += 301
    assert limiter.check("/v1/me", "9.9.9.9", "Bearer x") is None, "when the failures age out the address is free again"


def test_the_token_itself_is_never_a_key() -> None:
    limiter = RateLimiter(clock=Clock())
    limiter.check("/v1/me", "1.1.1.1", "Bearer the-secret-token-value")
    assert all("the-secret-token-value" not in key for key in limiter._token._hits)  # noqa: SLF001


# ---------------------------------------------------------------------------------------------- through the app
def test_the_app_refuses_the_121st_health_check_in_a_minute() -> None:
    client, _ = make_client(rate_limit=True)
    statuses = [client.get("/health").status_code for _ in range(122)]
    assert statuses.count(200) == 120 and statuses[-1] == 429
    refused = client.get("/health")
    assert refused.status_code == 429 and refused.json()["error"]["code"] == "rate_limited" and int(refused.headers["retry-after"]) >= 1
    assert "Too many requests" in refused.json()["error"]["message"]
    assert refused.headers["x-content-type-options"] == "nosniff", "a refusal carries the security headers too"


def test_a_preflight_is_not_counted() -> None:
    settings = Settings(_env_file=None, api_env="development", rate_limit_enabled=True, api_cors_origins="https://app.example.test")  # type: ignore[call-arg]
    client = TestClient(create_app(settings))
    for _ in range(200):
        r = client.options("/health", headers={"Origin": "https://app.example.test", "Access-Control-Request-Method": "GET"})
        assert r.status_code == 200
    assert client.get("/health").status_code == 200


def test_the_x_forwarded_for_header_is_ignored_unless_proxies_are_trusted() -> None:
    scope = {"client": ("10.0.0.5", 1), "headers": [(b"x-forwarded-for", b"6.6.6.6, 7.7.7.7")]}
    assert client_ip(scope, 0) == "10.0.0.5", "a client can write anything at the left of the header"
    assert client_ip(scope, 1) == "7.7.7.7" and client_ip(scope, 2) == "6.6.6.6"
    assert client_ip(scope, 3) == "10.0.0.5", "fewer addresses than trusted hops: the socket's address"
    assert client_ip({"client": ("10.0.0.5", 1), "headers": [(b"x-forwarded-for", b"not-an-ip")]}, 1) == "10.0.0.5"
    assert client_ip({"client": None, "headers": []}, 0) == "unknown"
    assert short_hash("1.2.3.4") != short_hash("1.2.3.5") and len(short_hash("1.2.3.4")) == 8


# ---------------------------------------------------------------------------------------------- headers and size
def test_every_response_carries_the_security_headers() -> None:
    client, _ = make_client()
    for response in (client.get("/health"), client.get(f"/v1/tenants/{TENANT_A.id}/companies", headers=auth("a_owner")), client.get("/v1/me")):
        h = response.headers
        assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY" and h["referrer-policy"] == "no-referrer"
        assert h["cache-control"] == "no-store" and "default-src 'none'" in h["content-security-policy"]
        assert "strict-transport-security" not in h, "HSTS only in production"
    assert "x-powered-by" not in client.get("/health").headers


async def _asgi(app: Any, *, headers: list[tuple[bytes, bytes]], chunks: list[bytes], path: str = "/x") -> tuple[int, dict[bytes, bytes], bytes]:
    status = 0
    out_headers: dict[bytes, bytes] = {}
    body = b""
    pending = list(chunks)

    async def receive() -> dict[str, Any]:
        if pending:
            chunk = pending.pop(0)
            return {"type": "http.request", "body": chunk, "more_body": bool(pending)}
        return {"type": "http.disconnect"}

    async def send(message: dict[str, Any]) -> None:
        nonlocal status, body
        if message["type"] == "http.response.start":
            status = message["status"]
            out_headers.update(dict(message["headers"]))
        elif message["type"] == "http.response.body":
            body += message.get("body", b"")

    await app({"type": "http", "method": "POST", "path": path, "headers": headers, "client": ("1.1.1.1", 1)}, receive, send)
    return status, out_headers, body


async def _reading_app(scope: Any, receive: Any, send: Any) -> None:
    total = 0
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        total += len(message.get("body", b""))
        if not message.get("more_body"):
            break
    await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": str(total).encode()})


def test_hsts_is_sent_only_in_production() -> None:
    prod = SecurityHeadersMiddleware(_reading_app, production=True)
    status, headers, _ = asyncio.run(_asgi(prod, headers=[], chunks=[b""]))
    assert status == 200 and headers[b"strict-transport-security"].startswith(b"max-age=")
    dev = SecurityHeadersMiddleware(_reading_app, production=False)
    assert b"strict-transport-security" not in asyncio.run(_asgi(dev, headers=[], chunks=[b""]))[1]


def test_a_request_over_the_ceiling_is_refused_by_its_declared_length() -> None:
    app = SecurityHeadersMiddleware(_reading_app, max_body=100)
    status, headers, body = asyncio.run(_asgi(app, headers=[(b"content-length", b"101")], chunks=[b"x" * 101]))
    assert status == 413 and json.loads(body)["error"]["code"] == "payload_too_large" and headers[b"x-content-type-options"] == b"nosniff"
    assert asyncio.run(_asgi(app, headers=[(b"content-length", b"100")], chunks=[b"x" * 100]))[0] == 200


def test_a_body_without_a_length_is_cut_off_at_the_ceiling() -> None:
    app = SecurityHeadersMiddleware(_reading_app, max_body=100)
    status, _, body = asyncio.run(_asgi(app, headers=[], chunks=[b"x" * 60, b"x" * 60]))
    assert status == 413 and json.loads(body)["error"]["code"] == "payload_too_large"
    assert asyncio.run(_asgi(app, headers=[], chunks=[b"x" * 60, b"x" * 40]))[0] == 200


# ---------------------------------------------------------------------------------------------- request id, the access line, the metrics
def test_a_request_id_is_made_or_kept_and_returned() -> None:
    client, _ = make_client()
    made = client.get("/health").headers["x-request-id"]
    assert len(made) == 32 and made != client.get("/health").headers["x-request-id"]
    assert client.get("/health", headers={"X-Request-Id": "abc-12345678"}).headers["x-request-id"] == "abc-12345678"
    for bad in ("short", "has space in it 123", "x" * 80, "<script>alert(1)</script>"):
        assert client.get("/health", headers={"X-Request-Id": bad}).headers["x-request-id"] != bad


def test_the_access_line_holds_the_route_and_no_personal_data(caplog: pytest.LogCaptureFixture) -> None:
    client, _ = make_client()
    with caplog.at_level(logging.INFO, logger="app.access"):
        client.get(f"/v1/tenants/{TENANT_A.id}/companies?q=Ravi+Kumar+9876543210", headers=auth("a_owner", email="ravi@example.test"))
        client.get("/health")
    lines = [r for r in caplog.records if r.name == "app.access"]
    assert len(lines) == 2
    fields = lines[0].fields  # type: ignore[attr-defined]
    assert fields["route"] == "/v1/tenants/{tenant_id}/companies" and fields["method"] == "GET" and fields["status"] == 200 and len(fields["caller"]) == 8
    assert set(fields) == {"request_id", "method", "route", "status", "ms", "caller"}
    blob = json.dumps(fields)
    assert str(TENANT_A.id) not in blob and "Ravi" not in blob and "9876543210" not in blob and "ravi@example.test" not in blob and "testclient" not in blob


def test_metrics_are_off_without_a_token_and_need_it_when_set() -> None:
    client, _ = make_client()
    assert client.get("/metrics").status_code == 404
    on = TestClient(create_app(Settings(_env_file=None, api_env="development", metrics_token=SecretStr("scrape-token-for-tests-only"))))  # type: ignore[call-arg]
    assert on.get("/metrics").status_code == 404, "no token"
    assert on.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 404
    assert on.get("/metrics", headers={"Authorization": "Basic scrape-token-for-tests-only"}).status_code == 404
    on.get("/health")
    ok = on.get("/metrics", headers={"Authorization": "Bearer scrape-token-for-tests-only"})
    assert ok.status_code == 200 and ok.headers["content-type"].startswith("text/plain")
    assert 'http_requests_total{method="GET",route="/health",status="2xx"}' in ok.text
    assert "app_uptime_seconds" in ok.text and 'http_request_duration_seconds_bucket{route="/health",le="+Inf"}' in ok.text
    assert "scrape-token-for-tests-only" not in ok.text


def test_metrics_count_the_route_pattern_never_the_path() -> None:
    m = Metrics()
    m.observe("GET", "/v1/tenants/{tenant_id}/orders", 200, 0.02)
    m.observe("GET", "/v1/tenants/{tenant_id}/orders", 404, 0.3)
    m.limit_hit("health")
    text = m.render()
    assert 'route="/v1/tenants/{tenant_id}/orders",status="2xx"} 1' in text and 'status="4xx"} 1' in text
    assert 'rate_limited_total{rule="health"} 1' in text and "le=\"0.05\"} 1" in text


def test_a_rate_limited_request_is_counted() -> None:
    on = TestClient(create_app(Settings(_env_file=None, api_env="development", metrics_token=SecretStr("t" * 20), rate_limit_enabled=True)))  # type: ignore[call-arg]
    statuses = [on.get("/ready").status_code for _ in range(35)]
    assert 429 in statuses and statuses.count(429) == 35 - 30 or statuses.count(429) >= 1
    page = on.get("/metrics", headers={"Authorization": "Bearer " + "t" * 20})
    assert page.status_code == 200
    assert f'rate_limited_total{{rule="ready"}} {statuses.count(429)}' in page.text
    assert 'status="4xx"' in page.text


# ---------------------------------------------------------------------------------------------- the log format
def test_the_scrubber_masks_emails_and_phone_sized_numbers() -> None:
    assert scrub("mail ravi.k@example.com or call +91 98765 43210 now") == "mail [email] or call [number] now"
    assert scrub("order 12 total 4000 id 7f3c") == "order 12 total 4000 id 7f3c", "short numbers are not masked"
    assert scrub("phone 09876543210.") == "phone [number]."
    assert scrub("uuid 00000000-0000-4000-8000-000000000001") == "uuid 00000000-0000-4000-8000-000000000001"


def test_the_json_formatter() -> None:
    record = logging.LogRecord("app.x", logging.WARNING, __file__, 1, "failed for %s", ("a@b.example",), None)
    record.fields = {"request_id": "abc", "status": 500}
    line = json.loads(JsonFormatter().format(record))
    assert line["level"] == "warning" and line["logger"] == "app.x" and line["msg"] == "failed for [email]" and line["request_id"] == "abc" and line["ts"].endswith("+00:00")
    try:
        raise ValueError("secret detail 9876543210")
    except ValueError:
        import sys

        rec = logging.LogRecord("app.x", logging.ERROR, __file__, 1, "boom", (), sys.exc_info())
    out = JsonFormatter().format(rec)
    assert json.loads(out)["exc"] == "ValueError" and "9876543210" not in out


def test_install_logging_is_idempotent_and_json_on_request() -> None:
    root = logging.getLogger()
    before = list(root.handlers)
    try:
        install_logging("json")
        install_logging("json")
        assert all(sum(isinstance(f, ScrubFilter) for f in h.filters) == 1 for h in root.handlers)
        assert all(isinstance(h.formatter, JsonFormatter) for h in root.handlers)
    finally:
        for h in list(root.handlers):
            if h not in before:
                root.removeHandler(h)
            else:
                h.filters = [f for f in h.filters if not isinstance(f, ScrubFilter)]
                h.setFormatter(None)


# ---------------------------------------------------------------------------------------------- readiness
def test_ready_asks_the_data_layer_and_answers_with_fixed_words() -> None:
    client, repo = make_client()
    ok = client.get("/ready")
    assert ok.status_code == 200 and ok.json() == {"status": "ready", "checks": {"auth": "ok"}}
    repo.ping = lambda: False  # type: ignore[attr-defined]
    down = client.get("/ready")
    assert down.status_code == 503 and down.json() == {"status": "not_ready", "checks": {"auth": "ok", "database": "down"}}
    repo.ping = lambda: True  # type: ignore[attr-defined]
    assert client.get("/ready").json()["checks"]["database"] == "ok"


def test_ready_without_auth_configuration_is_not_ready() -> None:
    app = create_app(Settings(_env_file=None, api_env="development"))  # type: ignore[call-arg]
    r = TestClient(app).get("/ready")
    assert r.status_code == 503 and r.json()["checks"] == {"auth": "not_configured"}


@pytest.mark.parametrize(("handler", "expected"), [(lambda r: httpx.Response(200), True), (lambda r: httpx.Response(503), False), (lambda r: httpx.Response(401), True)])
def test_the_repository_ping(handler: Any, expected: bool) -> None:
    repo = PostgrestTenantRepository("http://x.test", "anon", client=httpx.Client(base_url="http://x.test", transport=httpx.MockTransport(handler)))
    assert repo.ping() is expected


def test_the_repository_ping_survives_a_network_failure() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host 10.1.2.3")

    repo = PostgrestTenantRepository("http://x.test", "anon", client=httpx.Client(base_url="http://x.test", transport=httpx.MockTransport(down)))
    assert repo.ping() is False


# ---------------------------------------------------------------------------------------------- documentation and CORS
def test_the_documentation_is_on_in_development_and_off_in_production() -> None:
    dev = TestClient(create_app(Settings(_env_file=None, api_env="development")))  # type: ignore[call-arg]
    assert dev.get("/docs").status_code == 200 and dev.get("/openapi.json").status_code == 200
    from tests.test_config_fail_closed import VALID_PROD

    prod = TestClient(create_app(Settings(_env_file=None, **VALID_PROD)))  # type: ignore[call-arg]
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert prod.get(path).status_code == 404, path
    exposed = TestClient(create_app(Settings(_env_file=None, **{**VALID_PROD, "expose_api_docs": True})))  # type: ignore[call-arg]
    assert exposed.get("/openapi.json").status_code == 200
    r = prod.get("/health")
    assert r.headers["strict-transport-security"].startswith("max-age=31536000")


def test_cors_answers_only_the_configured_origins_and_never_with_credentials() -> None:
    client = TestClient(create_app(Settings(_env_file=None, api_env="development", api_cors_origins="https://app.example.test")))  # type: ignore[call-arg]
    ok = client.options("/health", headers={"Origin": "https://app.example.test", "Access-Control-Request-Method": "GET"})
    assert ok.headers["access-control-allow-origin"] == "https://app.example.test" and "access-control-allow-credentials" not in ok.headers
    bad = client.options("/health", headers={"Origin": "https://evil.example.test", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers
    plain = client.get("/health", headers={"Origin": "https://evil.example.test"})
    assert "access-control-allow-origin" not in plain.headers
    methods = ok.headers["access-control-allow-methods"]
    assert "DELETE" not in methods and "GET" in methods
    none = TestClient(create_app(Settings(_env_file=None, api_env="development")))  # type: ignore[call-arg]
    assert "access-control-allow-origin" not in none.get("/health", headers={"Origin": "https://app.example.test"}).headers
    with pytest.raises(Exception):  # noqa: B017, PT011 - the settings refuse a wildcard
        Settings(_env_file=None, api_env="development", api_cors_origins="*").cors_origins  # type: ignore[call-arg]  # noqa: B018


def test_ratelimit_module_constants_are_sane() -> None:
    assert ratelimit.FAIL_LIMIT >= 10 and ratelimit.SUSPECT_LIMIT >= 10 and ratelimit.TOKEN_LIMIT >= 300
