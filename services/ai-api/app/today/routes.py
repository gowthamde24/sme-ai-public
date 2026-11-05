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

from app.auth.deps import (
    AnyMember,
    OwnerOrAdmin,
    Runtime,
    TenantContext,
    get_runtime,
    require_tenant_role,
)
from app.errors import ApiError
from app.tenancy.models import Role
from app.today import service
from app.today.models import (
    AgentStatusOut,
    AgentSwitchIn,
    AgentSwitchOut,
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


# ---------------------------------------------------------------------------------------------------------------------------------- a switch per helper
# the helpers of the sidebar (agents/status keys) <-> the agent types with a real switch (migration 20261231170000); the others are features without a switch of their own yet
_AGENT_OF = {"main": "assistant", "researcher": "research", "requirement_analyst": "requirement"}
_KEY_OF = {v: k for k, v in _AGENT_OF.items()}
_NOT_BUILT = ("lead_finder", "quote_writer", "followup_desk", "order_desk")
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


def _switch_items(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise ApiError(502, "upstream_error", "The switches could not be read.")
    real = {_KEY_OF[str(x["agent"])]: x for x in raw if isinstance(x, dict) and x.get("agent") in _KEY_OF}
    out = [{"agent": key, "enabled": bool(x["enabled"]), "can_switch": bool(x["can_switch"]), "reason_locked": x.get("reason_locked"), "done_today": int(x.get("done_today") or 0)}
           for key, x in real.items()]
    out += [{"agent": key, "enabled": True, "can_switch": False, "reason_locked": "not_built", "done_today": None} for key in _NOT_BUILT]
    return [AgentSwitchOut.model_validate(i).model_dump(mode="json") for i in out]


@router.get("/agents/switches", response_model=list[AgentSwitchOut])
def get_agent_switches(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> list[dict[str, Any]]:
    """Each helper's own switch for this workspace (Owner, Admin). A helper switched off cannot start a run (the database checks it where every run starts)."""
    return _switch_items(_repo(runtime).agent_switches(ctx.principal.token, ctx.tenant.id))


@router.put("/agents/{agent}/switch", response_model=AgentSwitchOut)
def put_agent_switch(agent: str, body: AgentSwitchIn, ctx: OwnerOnly, runtime: RuntimeDep) -> dict[str, Any]:
    """Switch one helper on or off for this workspace (Owner). 404 for a helper that is not one of the sidebar's; 409 not_switchable for one without a switch of its own yet."""
    if agent in _NOT_BUILT:
        raise ApiError(409, "not_switchable", "This helper has no switch of its own yet.")
    if agent not in _AGENT_OF:
        from app.errors import not_found

        raise not_found()
    _repo(runtime).agent_switch_set(ctx.principal.token, ctx.tenant.id, _AGENT_OF[agent], body.enabled)
    items = _switch_items(_repo(runtime).agent_switches(ctx.principal.token, ctx.tenant.id))
    return next(i for i in items if i["agent"] == agent)
