import json
from pathlib import Path

import jsonschema
from fastapi.testclient import TestClient

from app.main import create_app

SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "packages" / "contracts" / "health.schema.json"
)


def test_health_returns_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "ai-api"


def test_health_matches_shared_contract() -> None:
    client = TestClient(create_app())
    schema = json.loads(SCHEMA_PATH.read_text())
    jsonschema.validate(client.get("/health").json(), schema)


def test_cors_allows_only_configured_origin() -> None:
    client = TestClient(create_app())
    allowed = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:3000"
    blocked = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in blocked.headers
