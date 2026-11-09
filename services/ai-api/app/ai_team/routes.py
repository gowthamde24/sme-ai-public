"""My AI team v2 over HTTP (docs/contracts/ai-team.md), part T1:

  GET /v1/tenants/{tenant_id}/ai-team/day?date=   Owner, Admin, Sales   the lanes, marks, flow strip and cost of one India day (cached 15 s per workspace, person and day)
  GET /v1/tenants/{tenant_id}/ai-team/{helper}    Owner, Admin, Sales   a helper's side panel

The database builds the day from real rows (public.ai_team_day); a Viewer is refused there. NOTE: no `from __future__ import annotations` (FastAPI reads the signatures)."""

# ruff: noqa: E501

import threading
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query

from app.ai_team import service
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["ai-team"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
IST = ZoneInfo("Asia/Kolkata")
TTL_S = 15.0
_MAX = 2000
_cache: dict[tuple[uuid.UUID, str, str], tuple[float, dict[str, Any]]] = {}
_lock = threading.Lock()


def _repo(runtime: Runtime) -> Any:
    repo = getattr(runtime, "ai_team", None)
    if repo is None:
        raise ApiError(503, "ai_team_unavailable", "This is not available right now.")
    return repo


def _india_today() -> date:
    return datetime.now(IST).date()


def _date(raw: str | None) -> date:
    today = _india_today()
    if not raw:
        return today
    try:
        on = date.fromisoformat(raw)
    except ValueError:
        raise ApiError(422, "date_out_of_range", "Give a date as YYYY-MM-DD, today or up to 31 days back.") from None
    if on > today or on < today - timedelta(days=31):
        raise ApiError(422, "date_out_of_range", "Give a date as YYYY-MM-DD, today or up to 31 days back.")
    return on


def _raw_day(runtime: Runtime, ctx: TenantContext, on: date) -> dict[str, Any]:
    key = (ctx.tenant.id, str(ctx.principal.user_id), on.isoformat())
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit is not None and now - hit[0] < TTL_S:
            return hit[1]
    raw: dict[str, Any] = dict(_repo(runtime).day(ctx.principal.token, ctx.tenant.id, on))
    with _lock:
        if len(_cache) >= _MAX:
            _cache.clear()
        _cache[key] = (now, raw)
    return raw


@router.get("/ai-team/day")
def get_day(ctx: Reader, runtime: RuntimeDep, date_: Annotated[str | None, Query(alias="date", max_length=10)] = None) -> dict[str, Any]:
    return service.day_out(ctx.tenant.id, _raw_day(runtime, ctx, _date(date_)))


@router.get("/ai-team/{helper}")
def get_helper(helper: str, ctx: Reader, runtime: RuntimeDep) -> dict[str, Any]:
    if helper not in service.HELPERS:
        raise not_found()
    today = _india_today()
    raw = _raw_day(runtime, ctx, today)
    if helper not in service.helpers_for(raw):
        raise not_found()
    earlier: list[dict[str, Any]] = []
    if sum(1 for m in raw.get("marks") or [] if m.get("helper") == helper and m.get("in_day")) < 10:
        earlier = list(_raw_day(runtime, ctx, today - timedelta(days=1)).get("marks") or [])
    return service.panel_out(ctx.tenant.id, helper, raw, earlier)
