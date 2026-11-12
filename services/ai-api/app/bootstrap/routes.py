"""GET /v1/tenants/{tenant_id}/bootstrap: the reads the signed-in layout makes on EVERY page load, in one request (docs/plans/call-capacity-and-instances.md, section 2a).

Each part is the existing route run server-side, with the caller's own headers: the same authorization, the same data, no new logic. One slow or failed part does not fail the others; a failed part says its HTTP status
(the layout treats a 403 on `ai_usage` differently from a failure). Parts are run together, each with its own time limit. The sub-requests carry a private per-process header so the page limiter does not count them
as page requests of their own (the bootstrap request itself holds one slot); at most `MAX_PARTS_AT_ONCE` of them run at the same time in the whole process."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import datetime as dt
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict

from app.auth.deps import TenantContext, require_tenant_role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["bootstrap"])
any_member = require_tenant_role()   # any member of the workspace
AnyMember = Annotated[TenantContext, Depends(any_member)]

PART_TIMEOUT_S = 6.0
MAX_PARTS_AT_ONCE = 26
INTERNAL_HEADER = "x-internal-bootstrap"
SKIPPED_HEADERS = {"host", "content-length", "content-type", "connection", "transfer-encoding", "accept-encoding", INTERNAL_HEADER}
# part name -> the path after /v1/tenants/{tenant_id} ("" = the workspace itself); `me` is the one part outside the workspace
PARTS: dict[str, str] = {
    "tenant": "",
    "pack": "/pack",
    "modules": "/modules",
    "billing_access": "/billing/access",
    "billing_usage": "/billing/usage",
    "billing_entitlements": "/billing/entitlements",
    "ai_usage": "/ai-usage",
    "workspace_profile": "/workspace/profile",
    "lead_finder_availability": "/lead-finder/availability",
    "me_profile": "/me/profile",
    "today": "/today",
    "agents_status": "/agents/status",
}
STATUS_WORDS = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 422: "validation_error", 429: "rate_limited", 502: "upstream", 503: "busy", 504: "busy"}


class PartError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    status: int


class Part(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    data: Any | None = None
    error: PartError | None = None


class BootstrapOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parts: dict[str, Part]
    generated_at: dt.datetime


def _failed(status: int, body: Any = None) -> Part:
    code = ""
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        raw = str(body["error"].get("code") or "")
        code = raw if raw.replace("_", "").isalnum() and len(raw) <= 40 else ""
    return Part(ok=False, error=PartError(code=code or STATUS_WORDS.get(status, "error"), status=status))


async def _part(client: httpx.AsyncClient, gate: asyncio.Semaphore, path: str, headers: dict[str, str]) -> Part:
    try:
        async with asyncio.timeout(PART_TIMEOUT_S):
            async with gate:
                response = await client.get(path, headers=headers)
    except TimeoutError:
        return _failed(503)
    except Exception:   # noqa: BLE001 - one part never fails the others
        return _failed(500)
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code == 200 and body is not None:
        return Part(ok=True, data=body)
    return _failed(response.status_code, body)


@router.get("/bootstrap", response_model=BootstrapOut)
async def bootstrap(request: Request, ctx: AnyMember, response: Response) -> BootstrapOut:
    """The signed-in layout's reads in one answer (`me` and the workspace parts). Any member of the workspace."""
    response.headers["Cache-Control"] = "no-store"
    state = request.app.state
    gate = getattr(state, "bootstrap_gate", None)
    if gate is None:
        gate = state.bootstrap_gate = asyncio.Semaphore(MAX_PARTS_AT_ONCE)
    headers = {k: v for k, v in request.headers.items() if k.lower() not in SKIPPED_HEADERS}
    headers[INTERNAL_HEADER] = str(getattr(state, "internal_token", ""))
    base = f"/v1/tenants/{ctx.tenant.id}"
    wanted = {"me": "/v1/me", **{name: base + tail for name, tail in PARTS.items()}}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=request.app), base_url="http://internal", headers={"accept": "application/json"}) as client:
        done = await asyncio.gather(*(_part(client, gate, path, headers) for path in wanted.values()))
    return BootstrapOut(parts=dict(zip(wanted, done, strict=True)), generated_at=dt.datetime.now(dt.UTC))
