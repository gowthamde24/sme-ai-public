"""GET /v1/tenants/{tenant_id}/search?q=   any member   leads, customers, quotes, orders and (school) students that match, at most 5 a kind (docs/contracts/search.md)

The database function public.workspace_search is SECURITY INVOKER: the person's own row-level security decides every row. NOTE: no `from __future__ import annotations` (FastAPI)."""

# ruff: noqa: E501

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.rpc_base import RpcClient
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["search"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Member = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]


class PostgrestSearch:
    def __init__(self, rest_url: str, anon_key: str) -> None:
        self._rpc = RpcClient(rest_url, anon_key, timeout=5.0)

    def search(self, token: str, tenant_id: Any, q: str) -> dict[str, Any]:
        return self._rpc.object(token, "workspace_search", {"p_tenant_id": str(tenant_id), "p_q": q})


@router.get("/search")
def search(ctx: Member, runtime: RuntimeDep, q: Annotated[str, Query(max_length=400)] = "") -> dict[str, Any]:
    text = q.strip()
    if not 2 <= len(text) <= 80:   # the one validation shape: the field is named, the value never echoed
        raise ApiError(422, "validation_error", "Type 2 to 80 letters.", extra={"fields": ["q"]})
    repo = getattr(runtime, "search", None)
    if repo is None:
        raise ApiError(503, "search_unavailable", "Search is not available right now.")
    return dict(repo.search(ctx.principal.token, ctx.tenant.id, text))
