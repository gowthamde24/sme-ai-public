"""The assistant's tool list (job assistant-does-the-work, section 0 of docs/contracts/assistant-tools.md): GET /v1/tenants/{tenant_id}/assistant/tools.

The same catalogue the planner reads, decided from this application's own route list once per process. Owner, Admin and Sales read it (the cards carry their own words; this is for Settings -> Activity's
labels and a debug screen).

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

from functools import lru_cache
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from app.assistant_tools import catalog
from app.auth.deps import TenantContext, require_tenant_role
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["assistant"])
Worker = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]


@lru_cache(maxsize=1)
def _listing(key: int, openapi_json: str) -> dict[str, Any]:
    import json

    decisions = catalog.decide(catalog.operations(json.loads(openapi_json)))
    return {
        "items": [{"name": d.op.name, "method": d.op.method, "path": catalog.tail(d.op.path), "level": d.level, "sensitive": d.sensitive, "undo": d.undo, "summary": d.op.summary} for d in decisions if d.tool],
        "screen_only": [{"method": d.op.method, "path": catalog.tail(d.op.path), "reason": d.screen_only} for d in decisions if not d.tool],
    }


@router.get("/assistant/tools")
def tools(ctx: Worker, request: Request) -> dict[str, Any]:
    import json

    app = request.app
    return _listing(id(app), json.dumps(app.openapi()))
