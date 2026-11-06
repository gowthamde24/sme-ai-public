"""Sales and money at a glance (app v4, part 6; docs/contracts/money-and-stock.md). NOTE: no `from __future__ import annotations` (FastAPI).

  GET /money/summary?as_of=      Owner, Admin, Sales (a Viewer reads no money): owed, overdue, paid this month, how many customers owe / are overdue, the five who owe the most
  GET /catalogue/low-stock       any member: the items marked "few left", each with how many customers asked for something like it this week (approximate: name words in a lead's need)"""

# ruff: noqa: E501

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.rpc_base import RpcClient
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["sales"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Seller = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
Member = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]


class PostgrestGlance:
    def __init__(self, rest_url: str, anon_key: str) -> None:
        self._rpc = RpcClient(rest_url, anon_key, timeout=15.0)

    def money(self, token: str, tenant_id: Any, as_of: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "money_summary", {"p_tenant_id": str(tenant_id), "p_as_of": as_of.isoformat() if as_of else None})

    def low_stock(self, token: str, tenant_id: Any) -> list[dict[str, Any]]:
        out = self._rpc.call(token, "catalogue_low_stock", {"p_tenant_id": str(tenant_id)})
        return [dict(x) for x in out] if isinstance(out, list) else []


def _repo(runtime: Runtime) -> Any:
    repo = getattr(runtime, "glance", None)
    if repo is None:
        raise ApiError(503, "glance_unavailable", "This is not available right now.")
    return repo


@router.get("/money/summary")
def money_summary(ctx: Seller, runtime: RuntimeDep, as_of: date | None = None) -> dict[str, Any]:
    return dict(_repo(runtime).money(ctx.principal.token, ctx.tenant.id, as_of))


@router.get("/catalogue/low-stock")
def low_stock(ctx: Member, runtime: RuntimeDep) -> dict[str, Any]:
    return {"items": _repo(runtime).low_stock(ctx.principal.token, ctx.tenant.id), "counts_available": False}
