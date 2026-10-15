"""The reports of every pack under /v1/tenants/{tenant_id}/reports (job CV, ADR 0088; module `reports`), in ONE shape.

  GET /reports/catalogue                    the reports this business may run for this caller (each needs modules that are on; a Viewer is offered none)
  GET /reports/run/{code}?from=&to=         one report: figures, typed tables and series by day. `from` and `to` are India days (a range report: default the last 30 days; a day report: `to`; the weekly summary:
                                            `from` is a Monday). Owner, Admin and Sales read the pack reports; the weekly summary is the Owner's and Admin's.

(The existing GET /reports/weekly stays as it is. A school's own path, GET /institution/reports/{code}, answers the same shape.)

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.reports.models import CatalogueItemOut, CatalogueOut, ReportOut
from app.reports.repository import ReportsRepository
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/reports", tags=["reports"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Member = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]
Code = Annotated[str, Path(pattern=r"^[a-z]+\.[a-z_]+$", max_length=60)]


def _repo(runtime: Runtime) -> ReportsRepository:
    if runtime.reports is None:
        raise ApiError(503, "reports_unavailable", "Reports are not available right now.")
    return runtime.reports


@router.get("/catalogue", response_model=CatalogueOut)
def catalogue(ctx: Member, runtime: RuntimeDep) -> CatalogueOut:
    rows = _repo(runtime).catalogue(ctx.principal.token, ctx.tenant.id)
    return CatalogueOut(items=[CatalogueItemOut.model_validate(r) for r in rows])


@router.get("/run/{code}", response_model=ReportOut, response_model_by_alias=True)
def run(code: Code, ctx: Member, runtime: RuntimeDep, from_: Annotated[date | None, Query(alias="from")] = None, to: date | None = None) -> ReportOut:
    return ReportOut.model_validate(_repo(runtime).run(ctx.principal.token, ctx.tenant.id, code, from_, to))
