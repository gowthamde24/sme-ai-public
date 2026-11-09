"""My AI team v2 over HTTP (docs/contracts/ai-team.md), part T1:

  GET /v1/tenants/{tenant_id}/ai-team/day?date=   Owner, Admin, Sales   the lanes, marks, flow strip and cost of one India day (cached 15 s per workspace, person and day)
  GET /v1/tenants/{tenant_id}/ai-team/{helper}    Owner, Admin, Sales   a helper's side panel
  GET /v1/tenants/{tenant_id}/ai-team/standup     Owner, Admin          today's morning stand-up (text; made by the worker at opening time)
  POST /v1/tenants/{tenant_id}/ai-team/standup    Owner, Admin          make it again by hand (at most 3 a day per workspace)

The database builds the day from real rows (public.ai_team_day); a Viewer is refused there. NOTE: no `from __future__ import annotations` (FastAPI reads the signatures)."""

# ruff: noqa: E501

import threading
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app.ai_team import service, standup
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["ai-team"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
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


class StandupIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: str | None = Field(default=None, max_length=5)


@router.get("/ai-team/standup")
def get_standup(ctx: OwnerAdmin, runtime: RuntimeDep, language: Annotated[str | None, Query(max_length=5)] = None) -> dict[str, Any]:
    """Today's stand-up in the asked language (default en; a language without a stand-up is English). 404 not_generated until the worker (or the Owner) has made it."""
    got = _repo(runtime).standup_get(ctx.principal.token, ctx.tenant.id, _india_today(), standup.normalise(language))
    if got is None:
        raise ApiError(404, "not_generated", "Today's stand-up has not been made yet.")
    return service.standup_out(got)


@router.post("/ai-team/standup")
def make_standup(body: StandupIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Make today's stand-up again, now (Owner, Admin): from the real day numbers, by code. At most 3 a day per workspace (429 standup_limit with the seconds to India midnight); the same text does not count."""
    repo = _repo(runtime)
    today = _india_today()
    raw_today = dict(repo.day(ctx.principal.token, ctx.tenant.id, today))
    raw_yesterday = dict(repo.day(ctx.principal.token, ctx.tenant.id, today - timedelta(days=1)))
    built = service.make_standup(ctx.tenant.id, raw_yesterday, raw_today, standup.normalise(body.language), datetime.now(IST))
    saved = repo.standup_save(ctx.principal.token, ctx.tenant.id, today, built)
    if not saved.get("ok"):
        raise ApiError(429, "standup_limit", "You can make the stand-up again 3 times a day. Try again tomorrow morning.", retry_after=int(saved.get("retry_after_s") or 3600))
    return service.standup_out({k: v for k, v in saved.items() if k != "ok"})


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
