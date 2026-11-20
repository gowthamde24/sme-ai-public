"""Jobs, the read-only slice S2a (jobs contract 1.0 sections 0 and 3, 1.1 part 1 sections 1 and 7). All under /v1/tenants/{t}/jobs.

  GET /jobs/templates   Owner, Admin: the job templates of the workspace's business type and the other types' (an ETag on the answer, 304 on If-None-Match)
  GET /jobs/festivals   every member: the festivals of the workspace's region in the next 60 days, nearest first, one row per season

With JOBS off (the default) every route answers 404 `not_found` as if it did not exist, before anything else is checked (sign-in included).

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import hashlib
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse

from app import gstin as gstin_module
from app.auth.deps import AnyMember, OwnerOrAdmin, Runtime, get_runtime
from app.errors import ApiError, not_found
from app.jobs import festivals, templates
from app.jobs.models import FestivalOut, FestivalsOut
from app.jobs.wiring import JobsRuntime


def jobs_on(request: Request) -> JobsRuntime:
    """404 while JOBS is off: this runs first (a router dependency), so nothing about the route is revealed, not even to a caller who is not signed in."""
    jobs = getattr(getattr(request.app.state, "runtime", None), "jobs", None)
    if jobs is None:
        raise not_found()
    return jobs  # type: ignore[no-any-return]


router = APIRouter(prefix="/v1/tenants/{tenant_id}/jobs", tags=["jobs"], dependencies=[Depends(jobs_on)])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
JobsDep = Annotated[JobsRuntime, Depends(jobs_on)]


def _etag(body: Any) -> str:
    return '"' + hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()[:32] + '"'


def _matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    wanted = [part.strip().removeprefix("W/") for part in header.split(",")]
    return "*" in wanted or etag in wanted


def _answer(request: Request, body: dict[str, Any]) -> Response:
    """The JSON with its ETag; 304 and no body when the caller already holds this exact answer. `private, no-cache`: the answer is for this workspace (it may carry its own prospects), and is checked again each time."""
    etag = _etag(body)
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    return JSONResponse(body, headers=headers)


@router.get("/templates")
def get_templates(request: Request, ctx: OwnerOrAdmin, runtime: RuntimeDep, jobs: JobsDep) -> Response:
    if runtime.packs is None:
        raise ApiError(503, "packs_unavailable", "Business types are not available on this system.")
    token, tenant_id = ctx.principal.token, ctx.tenant.id
    row = runtime.packs.workspace_pack(token, tenant_id)
    manifest = row.get("manifest") or {}
    names = manifest.get("names") if isinstance(manifest, dict) else None
    out = templates.build(
        pack_id=str(row["pack_id"]),
        manifest_names={k: v for k, v in names.items() if isinstance(v, str)} if isinstance(names, dict) else {},
        directory=jobs.directory,
        get_paid=jobs.get_paid,
        item_name=templates.first_item_name(runtime.catalogue, token, tenant_id),
        real=templates.real_prospects(runtime.lead_finder, token, tenant_id),
    )
    return _answer(request, out.model_dump(mode="json", exclude_unset=True))


def _region(runtime: Runtime, token: str, tenant_id: Any) -> str:
    """The workspace's region from the state of its business profile (the GSTIN's state); no profile, no GSTIN or anything unreadable is india."""
    if runtime.business_profile is None:
        return festivals.FALLBACK_REGION
    try:
        gstin = gstin_module.parse(runtime.business_profile.get(token, tenant_id).get("gstin"))
    except Exception:  # noqa: BLE001 - the region is a nicety: the national calendar answers instead
        return festivals.FALLBACK_REGION
    return festivals.region_for_state(gstin_module.state_of(gstin) if gstin else None)


@router.get("/festivals", response_model=FestivalsOut)
def get_festivals(ctx: AnyMember, runtime: RuntimeDep, jobs: JobsDep) -> FestivalsOut:
    region = _region(runtime, ctx.principal.token, ctx.tenant.id)
    cal = festivals.calendar(jobs.directory)
    rows = festivals.upcoming(cal, region, festivals.today_in_india(jobs.clock)) if cal is not None else []
    return FestivalsOut(region=region, items=[FestivalOut(season=r.season, name=r.name, date=r.date.isoformat(), region=r.region) for r in rows])  # type: ignore[arg-type]


__all__ = ["router"]
