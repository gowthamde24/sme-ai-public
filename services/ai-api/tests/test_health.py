import json
from pathlib import Path
from typing import Any

import jsonschema
from fastapi.testclient import TestClient

from app.config import ConfigurationError, Settings
from app.main import create_app

SCHEMA_PATH = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "health.schema.json"


def test_health_returns_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "ai-api"


def settings(**over: Any) -> Settings:
    return Settings(_env_file=None, **over)  # type: ignore[call-arg]


def test_health_matches_shared_contract() -> None:
    client = TestClient(create_app())
    schema = json.loads(SCHEMA_PATH.read_text())
    jsonschema.validate(client.get("/health").json(), schema)


def test_cors_allows_only_configured_origin() -> None:
    client = TestClient(create_app(settings(api_cors_origins="http://localhost:3000")))
    allowed = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    blocked = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers


def preflight(client: TestClient, origin: str) -> dict[str, str]:
    r = client.options(
        "/v1/me",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    return dict(r.headers)


def test_cors_is_off_by_default() -> None:
    """The web app calls the API from its server: no browser origin needs access by default."""
    assert settings().api_cors_origins == ""
    client = TestClient(create_app(settings()))
    for origin in ("http://localhost:3000", "https://app.example.test", "null"):
        assert "access-control-allow-origin" not in preflight(client, origin)
        assert (
            "access-control-allow-origin"
            not in client.get("/health", headers={"Origin": origin}).headers
        )


def test_cors_names_its_methods_and_headers_and_never_allows_credentials() -> None:
    client = TestClient(create_app(settings(api_cors_origins="https://app.example.test")))
    h = preflight(client, "https://app.example.test")
    assert h["access-control-allow-origin"] == "https://app.example.test"
    allowed = {x.strip() for x in h["access-control-allow-headers"].split(",")}
    assert allowed == {
        "Accept",
        "Accept-Language",
        "Authorization",
        "Content-Language",
        "Content-Type",
    }
    assert "DELETE" not in h["access-control-allow-methods"]
    assert "access-control-allow-credentials" not in h
    assert "*" not in "".join(h.values())
    assert "access-control-allow-origin" not in preflight(client, "https://evil.example")
    # a look-alike of the allowed origin is not the allowed origin
    for look_alike in (
        "https://app.example.test.evil.example",
        "http://app.example.test",
        "https://APP.example.test:444",
    ):
        assert "access-control-allow-origin" not in preflight(client, look_alike), look_alike


import pytest  # noqa: E402


@pytest.mark.parametrize(
    "bad",
    [
        "*",
        "https://*.example.test",
        "https://app.example.test/",
        "https://app.example.test/path",
        "app.example.test",
        "https://",
        "null",
        "ftp://a.test",
        "https://a.test, *",
        "https://a.test:99999999",
    ],
)
def test_a_wildcard_or_a_malformed_origin_stops_the_process(bad: str) -> None:
    with pytest.raises(ConfigurationError):
        create_app(settings(api_cors_origins=bad))


def test_outside_development_only_https_origins_are_accepted() -> None:
    insecure = settings(api_env="production", api_cors_origins="http://app.example.test")
    with pytest.raises(ConfigurationError):
        _ = insecure.cors_origins
    ok = settings(
        api_env="production",
        api_cors_origins="https://app.example.test, https://other.example.test",
    )
    assert ok.cors_origins == ["https://app.example.test", "https://other.example.test"]
    dev = settings(api_cors_origins="http://localhost:3000")
    assert dev.cors_origins == ["http://localhost:3000"]
