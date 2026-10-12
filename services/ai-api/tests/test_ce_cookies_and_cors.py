"""Job CE (ADR 0072, addendum): the web at app.<domain> and the API at api.<domain>. The API takes no cookie as a credential, sets none, and answers CORS for the web's origin ONLY (no credentials, never '*'). The
web's side of the same arrangement (a host-only session cookie, no `credentials: "include"`) is tested in apps/web/lib/supabase/cookies.test.ts and apps/web/lib/api/no-browser-credentials.test.ts."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.test_config_fail_closed import VALID_PROD

WEB = "https://app.example.test"
API_HOST = "https://api.example.test"


def hosted(**over: Any) -> TestClient:
    return TestClient(create_app(Settings(_env_file=None, **{**VALID_PROD, "api_cors_origins": WEB, **over})))  # type: ignore[call-arg]


def preflight(client: TestClient, origin: str, method: str = "GET") -> dict[str, str]:
    r = client.options("/v1/me", headers={"Origin": origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization,content-type"})
    return {k.lower(): v for k, v in r.headers.items()}


def test_the_web_origin_is_answered_exactly_without_credentials() -> None:
    h = preflight(hosted(), WEB)
    assert h["access-control-allow-origin"] == WEB
    assert "access-control-allow-credentials" not in h
    assert "origin" in h.get("vary", "").lower()  # a cache must not serve one origin's answer to another


@pytest.mark.parametrize(
    "origin",
    [
        API_HOST,  # the API's own host is not the web
        "https://evil.example.test",  # a sibling subdomain of the same registrable domain
        "https://app.example.test.evil.test",  # a lookalike that starts like the web
        "https://xapp.example.test",
        "http://app.example.test",  # the same host over http
        "https://app.example.test:8443",  # the same host on another port
        "https://APP.EXAMPLE.TEST.",  # a trailing dot
        "null",  # a sandboxed page or a file
        "https://example.test",  # the parent domain
    ],
)
def test_no_other_origin_is_answered_not_even_a_sibling_subdomain(origin: str) -> None:
    client = hosted()
    assert "access-control-allow-origin" not in preflight(client, origin)
    assert "access-control-allow-origin" not in client.get("/health", headers={"Origin": origin}).headers


def test_no_wildcard_and_only_the_methods_and_headers_the_web_needs() -> None:
    h = preflight(hosted(), WEB, "POST")
    assert h["access-control-allow-origin"] != "*"
    assert "DELETE" not in h["access-control-allow-methods"]
    assert {x.strip().lower() for x in h["access-control-allow-headers"].split(",")} >= {"authorization", "content-type"}
    refused = hosted().options("/v1/me", headers={"Origin": WEB, "Access-Control-Request-Method": "DELETE"})
    assert refused.status_code == 400  # a method the API does not allow cross-origin


def test_with_no_origin_configured_the_browser_gets_no_cors_answer_at_all() -> None:
    client = hosted(api_cors_origins="")
    assert "access-control-allow-origin" not in preflight(client, WEB)


def test_a_session_cookie_is_not_a_credential_at_the_api() -> None:
    client = hosted()
    for cookie in ("sb-abcdefgh-auth-token=base64-eyJhbGciOiJFUzI1NiJ9.e30.sig", "sb-abcdefgh-auth-token.0=x; sb-abcdefgh-auth-token.1=y", "session=1"):
        r = client.get("/v1/me", headers={"Cookie": cookie, "Origin": WEB})
        assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    # and a cookie next to a bad bearer is still refused
    assert client.get("/v1/me", headers={"Cookie": "sb-abcdefgh-auth-token=x", "Authorization": "Bearer not-a-token"}).status_code == 401


def test_the_api_never_sets_a_cookie() -> None:
    client = hosted()
    answers = [
        client.get("/health"),
        client.get("/ready"),
        client.get("/v1/me"),  # 401
        client.get("/v1/no-such-route"),  # 404
        client.post("/v1/tenants", json={}),  # 401 before the body is read
        client.options("/v1/me", headers={"Origin": WEB, "Access-Control-Request-Method": "GET"}),
    ]
    for r in answers:
        assert "set-cookie" not in r.headers, r.request.url


def test_the_error_of_a_refused_call_has_the_request_id_the_web_shows_to_the_owner() -> None:
    r = hosted().get("/v1/me", headers={"x-request-id": "rehearsal-0001"})
    assert r.headers["x-request-id"] == "rehearsal-0001" and r.json()["error"]["request_id"] == "rehearsal-0001"
