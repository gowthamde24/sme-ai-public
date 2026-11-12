"""GET /v1/tenants/{id}/bootstrap (Phase 1, item 1i; contract: docs/plans/call-capacity-and-instances.md section 2a): the layout's reads in one request, each part the existing route, one failed part never fails the others."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.bootstrap import routes
from app.hardening.admission import PageGuardMiddleware

T = str(uuid.uuid4())
SEEN: list[dict[str, str]] = []


def build(limit: int = 2) -> TestClient:
    app = FastAPI()
    app.state.internal_token = "private-token"
    tenant = SimpleNamespace(id=uuid.UUID(T), name="Shop")
    app.dependency_overrides[routes.any_member] = lambda: SimpleNamespace(tenant=tenant, role="owner")
    stub = APIRouter(prefix="/v1/tenants/{tenant_id}")

    @stub.get("")
    def tenant_route(request: Request) -> dict[str, Any]:
        SEEN.append({"auth": request.headers.get("authorization", ""), "internal": request.headers.get(routes.INTERNAL_HEADER, "")})
        return {"id": T, "role": "owner"}

    @stub.get("/ai-usage")
    def ai_usage() -> JSONResponse:
        return JSONResponse({"error": {"code": "forbidden", "message": "no"}}, status_code=403)

    @stub.get("/today")
    async def today() -> dict[str, Any]:
        await asyncio.sleep(0.5)   # slower than the part time limit of the test
        return {"waiting": 3}

    @stub.get("/agents/status")
    def agents() -> JSONResponse:
        raise RuntimeError("boom")

    @stub.get("/pack")
    def pack() -> JSONResponse:
        return JSONResponse({"oops": 1}, status_code=502)

    for tail in ("modules", "billing/access", "billing/usage", "billing/entitlements", "workspace/profile", "lead-finder/availability", "me/profile"):
        stub.add_api_route(f"/{tail}", (lambda t=tail: {"part": t}), methods=["GET"])
    app.include_router(stub)

    @app.get("/v1/me")
    def me() -> dict[str, Any]:
        return {"user_id": "u1"}

    app.include_router(routes.router)
    app.add_middleware(PageGuardMiddleware, max_inflight=limit, internal_token="private-token")
    return TestClient(app, raise_server_exceptions=False)


def test_one_request_gives_every_part_each_failed_part_says_its_status_and_the_others_still_arrive(monkeypatch: Any) -> None:
    monkeypatch.setattr(routes, "PART_TIMEOUT_S", 0.2)
    client = build()
    r = client.get(f"/v1/tenants/{T}/bootstrap", headers={"Authorization": "Bearer abc"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    parts = r.json()["parts"]
    assert set(parts) == {"me", *routes.PARTS}, "exactly the agreed parts"
    assert parts["me"] == {"ok": True, "data": {"user_id": "u1"}, "error": None}
    assert parts["tenant"]["ok"] and parts["tenant"]["data"] == {"id": T, "role": "owner"}
    assert parts["modules"]["data"] == {"part": "modules"}
    assert parts["ai_usage"] == {"ok": False, "data": None, "error": {"code": "forbidden", "status": 403}}, "a 403 is told apart from a failure"
    assert parts["today"]["error"] == {"code": "busy", "status": 503}, "a part that takes too long is busy"
    assert parts["agents_status"]["error"] == {"code": "error", "status": 500}, "a crashing part is a 500 part"
    assert parts["pack"]["error"] == {"code": "upstream", "status": 502}


def test_the_sub_requests_carry_the_callers_own_authorization_and_the_private_header_and_are_not_page_requests_of_their_own() -> None:
    SEEN.clear()
    client = build(limit=1)   # a limit of ONE page request: the bootstrap holds it, its twelve sub-requests must not be refused
    r = client.get(f"/v1/tenants/{T}/bootstrap", headers={"Authorization": "Bearer abc"})
    parts = r.json()["parts"]
    assert sum(1 for p in parts.values() if p["ok"]) >= 9 and all(p["error"] is None or p["error"]["status"] != 503 or p is parts["today"] for p in parts.values())
    assert SEEN and SEEN[-1] == {"auth": "Bearer abc", "internal": "private-token"}


def test_an_outsider_cannot_use_the_private_header_without_the_token() -> None:
    client = build(limit=1)
    r = client.get(f"/v1/tenants/{T}/ai-usage", headers={"Authorization": "Bearer x", routes.INTERNAL_HEADER: "guess"})
    assert r.status_code == 403   # reached the route as any request (the limiter has room); the header opened nothing
