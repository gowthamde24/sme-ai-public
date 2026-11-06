"""GET /v1/tenants/{tenant_id}/customers/{lead_id}/timeline?before=&limit=   any member   one customer's calls, messages, quotes, visits, orders, follow-ups and outcomes, newest first
(app v4, part 3; docs/contracts/customer-timeline.md). The database function public.customer_timeline is SECURITY INVOKER: the member's own row-level security decides every row.
NOTE: no `from __future__ import annotations` (FastAPI)."""

# ruff: noqa: E501

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.rpc_base import RpcClient
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["customers"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Member = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]


class PostgrestTimeline:
    def __init__(self, rest_url: str, anon_key: str) -> None:
        self._rpc = RpcClient(rest_url, anon_key, timeout=8.0)

    def timeline(self, token: str, tenant_id: Any, lead_id: uuid.UUID, before: datetime | None, limit: int) -> list[dict[str, Any]]:
        out = self._rpc.call(token, "customer_timeline", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id), "p_before": before.isoformat() if before else None, "p_limit": limit})
        return [dict(x) for x in out] if isinstance(out, list) else []


@router.get("/customers/{lead_id}/timeline")
def customer_timeline(ctx: Member, runtime: RuntimeDep, lead_id: uuid.UUID, before: datetime | None = None, limit: Annotated[int, Query(ge=1, le=100)] = 50) -> dict[str, Any]:
    """{items: [{kind, at, text, target: {type, id}, detail}], next_before}: `next_before` is the `at` to pass as `before` for the next (older) page; null when this page is the last."""
    repo = getattr(runtime, "timeline", None)
    if repo is None:
        raise ApiError(503, "timeline_unavailable", "The timeline is not available right now.")
    items = repo.timeline(ctx.principal.token, ctx.tenant.id, lead_id, before, limit)
    return {"items": items, "next_before": items[-1]["at"] if len(items) == limit else None}
