"""Today, AI usage and the helpers' status under /v1/tenants/{tenant_id}/... (job AD / D3).

Reads only. Authorization, in order: a valid JWT (401); membership of the tenant in the PATH
(404 for unknown and foreign alike); for AI usage a role of Owner or Admin (403); then the
database reads under the caller's own row-level security. The API decides and writes nothing.

NOTE: no `from __future__ import annotations` here, for the same reason as
app/orders/routes.py (models are attached to the endpoint signatures at registration time).
"""

import threading
import time
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth.deps import AnyMember, OwnerOrAdmin, Runtime, get_runtime
from app.errors import ApiError
from app.today import service
from app.today.models import (
    AgentStatusOut,
    AiUsageOut,
    AiUsagePercentOut,
    AiUsageWeekOut,
    NavCountsOut,
    TodayOut,
)

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
    """Today's (Asia/Kolkata day) AI spend against the daily cap, in paise. Owner, Admin."""
    return service.shape_ai_usage(_repo(runtime).ai_usage(ctx.principal.token, ctx.tenant.id))


@router.get("/ai-usage", response_model=AiUsagePercentOut)
def get_ai_usage(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> AiUsagePercentOut:
    """How much of today's (India day) and this month's AI allowance is used, as percentages. Owner, Admin. No amounts."""
    return service.shape_ai_usage_percent(
        _repo(runtime).ai_usage_percent(ctx.principal.token, ctx.tenant.id)
    )


@router.get("/ai-usage/week", response_model=AiUsageWeekOut)
def get_ai_usage_week(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> AiUsageWeekOut:
    """This week's (Monday to Sunday, India time) share of the AI allowance as a percentage, and when the week resets. Owner, Admin. No amounts, no counts."""
    return service.shape_ai_usage_week(
        _repo(runtime).ai_usage_week(ctx.principal.token, ctx.tenant.id)
    )


@router.get("/agents/status", response_model=list[AgentStatusOut])
def get_agents_status(ctx: AnyMember, runtime: RuntimeDep) -> list[AgentStatusOut]:
    """The seven helpers, always all seven in the same order, each with its latest real event."""
    return service.shape_agents(_repo(runtime).agents_status(ctx.principal.token, ctx.tenant.id))


# ---------------------------------------------------------------------------------------------------------------------------------- the sidebar's counts
NAV_TTL_S = 30.0
_NAV_MAX = 5000
_nav_cache: dict[tuple[uuid.UUID, str], tuple[float, dict[str, Any]]] = {}
_nav_lock = threading.Lock()


@router.get("/nav-counts", response_model=NavCountsOut)
def get_nav_counts(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    """The sidebar's counts in one cheap read (docs/contracts/nav-counts.md): each by the caller's role, null = not for you. Kept 30 s per person and workspace (new_leads is per person: what THEY
    have not opened), so a page that polls on focus costs at most one database read every 30 s."""
    key = (ctx.tenant.id, str(ctx.principal.user_id))
    now = time.monotonic()
    with _nav_lock:
        hit = _nav_cache.get(key)
        if hit is not None and now - hit[0] < NAV_TTL_S:
            return hit[1]
    raw = _repo(runtime).nav_counts(ctx.principal.token, ctx.tenant.id)
    if not isinstance(raw, dict):
        raise ApiError(502, "upstream_error", "The counts could not be read.")
    out = NavCountsOut.model_validate(raw).model_dump(mode="json")
    with _nav_lock:
        if len(_nav_cache) >= _NAV_MAX:
            _nav_cache.clear()
        _nav_cache[key] = (now, out)
    return out
