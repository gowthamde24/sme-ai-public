"""Today, AI usage and the helpers' status under /v1/tenants/{tenant_id}/... (job AD / D3).

Reads only. Authorization, in order: a valid JWT (401); membership of the tenant in the PATH
(404 for unknown and foreign alike); for AI usage a role of Owner or Admin (403); then the
database reads under the caller's own row-level security. The API decides and writes nothing.

NOTE: no `from __future__ import annotations` here, for the same reason as
app/orders/routes.py (models are attached to the endpoint signatures at registration time).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth.deps import AnyMember, OwnerOrAdmin, Runtime, get_runtime
from app.errors import ApiError
from app.today import service
from app.today.models import AgentStatusOut, AiUsageOut, TodayOut

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["today"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


def _repo(runtime: Runtime) -> Any:
    if runtime.today is None:
        raise ApiError(503, "today_unavailable", "This is not available right now.")
    return runtime.today


@router.get("/today", response_model=TodayOut)
def get_today(ctx: AnyMember, runtime: RuntimeDep) -> TodayOut:
    """What waits for the caller, money held on closed orders, open orders, the last five steps.

    Shaped by the caller's role (the database decides what each role may read).
    """
    return service.shape_today(_repo(runtime).today_summary(ctx.principal.token, ctx.tenant.id))


@router.get("/ai-usage/today", response_model=AiUsageOut)
def get_ai_usage_today(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> AiUsageOut:
    """Today's AI spend against the daily cap, in paise (from agent-run cost). Owner, Admin."""
    return service.shape_ai_usage(_repo(runtime).cost_summary(ctx.principal.token, ctx.tenant.id))


@router.get("/agents/status", response_model=list[AgentStatusOut])
def get_agents_status(ctx: AnyMember, runtime: RuntimeDep) -> list[AgentStatusOut]:
    """The seven helpers, always all seven in the same order, each with its latest real event."""
    return service.shape_agents(_repo(runtime).agents_status(ctx.principal.token, ctx.tenant.id))
