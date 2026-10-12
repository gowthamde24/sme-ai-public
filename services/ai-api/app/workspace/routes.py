"""The shop's basics and the weekly report under /v1/tenants/{t} (job BY, ADR 0077).

  GET /profile                         any member  -> {name, town, languages, setup_complete, missing: ["town","languages"], updated_at}   (the setup wizard's state)
  PUT /profile                         Owner/Admin  {name?, town?, languages?}   each optional: what is left out is kept   -> the profile
  GET /reports/weekly?week_start=      Owner/Admin  one India week (Monday to Sunday; default this week)   -> the report below
The report: {week_start, week_end, timezone, current, visits: {booked, arrived, bought, will_return, not_interested, no_show, cancelled}, messages: {sent, failed, waiting, blocked},
response: {asked, answered, unanswered, median_seconds}, top_sarees: [{item_id, name, sent}], ai_usage_percent (null for a past week)}."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.tenancy.models import Role
from app.workspace.models import ProfileIn
from app.workspace.repository import WorkspaceRepository

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["workspace"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]


def _repo(runtime: Runtime) -> WorkspaceRepository:
    if runtime.workspace is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.workspace


@router.get("/profile")
def get_profile(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    return _repo(runtime).profile(ctx.principal.token, ctx.tenant.id)


@router.put("/profile")
def save_profile(body: ProfileIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return _repo(runtime).save_profile(ctx.principal.token, ctx.tenant.id, body.name, body.town, list(body.languages) if body.languages else None)


@router.get("/reports/weekly")
def weekly_report(ctx: OwnerAdmin, runtime: RuntimeDep, week_start: date | None = None) -> dict[str, Any]:
    return _repo(runtime).weekly_report(ctx.principal.token, ctx.tenant.id, week_start)
