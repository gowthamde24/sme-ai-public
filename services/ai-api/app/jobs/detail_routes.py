"""The job page and its switch, slice S2 (jobs contract 1.0 sections 1 to 3, 14, 15; docs/contracts/jobs-detail.md). All under /v1/tenants/{t}/jobs; 404 while JOBS is off (before anything else).

  GET   /jobs/{id}          every member: the JobDetail (an ETag on the answer, 304 on If-None-Match)
  PATCH /jobs/{id}          Owner, Admin: {enabled?, name?, settings?, finds_out?} -> the fresh JobDetail. `enabled` is the underlying switch (pause and resume, never an approval); `name` is the owner's own name for the
                            helper (public.job_meta_set_name: 422 name_invalid); `settings` go through the catalogue (app/jobs/catalogue.py: a value outside `options` is 422 setting_invalid, naming the key); `finds_out` is
                            {key: bool} of the kind's closed keys. Everything is checked before the first write.
  POST  /jobs/{id}/pause    Owner, Admin: -> the Job;  POST /jobs/{id}/resume: the same, the other way
  A job id that is not one of this workspace's jobs is 404 (the id is per workspace and kind: a foreign or invented id never reveals anything).

The database decides who may do each write, with the caller's own token: a standing rule, the follow-up policy and the greeting override need the Owner and the second factor (403 mfa_required), the rest Owner or Admin.
NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time). Registered AFTER the other /jobs routers: a path with a word in it (/jobs/today,
/jobs/templates, /jobs/plan, /jobs/suggestions) must be matched before `/{job_id}`."""

# ruff: noqa: E501

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.auth.deps import AnyMember, OwnerOrAdmin, Runtime, get_runtime
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.jobs import catalogue, control, detail, listing
from app.jobs import needs as needs_mod
from app.jobs.routes import _answer, _etag, jobs_on
from app.jobs.trust import REFUSALS, JobsRefused
from app.jobs.wiring import JobsRuntime

router = APIRouter(prefix="/v1/tenants/{tenant_id}/jobs", tags=["jobs"], dependencies=[Depends(jobs_on)])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
JobsDep = Annotated[JobsRuntime, Depends(jobs_on)]
MAX_NAME = 40


class JobPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: StrictBool | None = None
    name: str | None = Field(default=None, max_length=400)   # empty, only spaces or null clears it; the rest is the database's rule (<= 40 characters, not a number, not a web address)
    settings: dict[str, Any] | None = Field(default=None, max_length=20)
    finds_out: dict[str, StrictBool] | None = Field(default=None, max_length=10)


def _kind_of(job_id: str, tenant_id: uuid.UUID) -> str:
    parsed = parse_uuid(job_id)
    kind = next((k for k in listing.KINDS if parsed is not None and listing.job_id(tenant_id, k) == parsed), None)
    if kind is None:
        raise not_found()
    return kind


def _refused(call: Any) -> Any:
    """One trust call; a closed refusal of the database becomes its fixed sentence (nothing from the data layer)."""
    try:
        return call()
    except JobsRefused as refused:
        status, code, message = REFUSALS[refused.code]
        raise ApiError(status, code, message) from None


def _name_invalid() -> ApiError:
    status, code, message = REFUSALS["SM983"]
    return ApiError(status, code, message)


def _finds_out_ok(kind: str, given: dict[str, bool]) -> None:
    allowed = catalogue.FINDS_OUT.get(kind, ())
    bad = sorted(k for k in given if k not in allowed)
    if bad:
        raise ApiError(422, "setting_invalid", "That choice is not one of the options.", extra={"fields": [f"finds_out.{k}" for k in bad]})


def _wants_switch(kind: str, enabled: bool | None, current: dict[str, Any]) -> bool:
    """Should the switch be turned? A job with a switch is asked every time (pause and resume only touch what is on or what the owner paused, so asking twice is harmless). A job with none answers 409 when the word would change it."""
    if enabled is None:
        return False
    if kind in control.SWITCHABLE:
        return True
    if enabled != current["enabled"]:
        raise control.not_switchable()
    return False


def _json(body: dict[str, Any]) -> JSONResponse:
    return JSONResponse(body, headers={"ETag": _etag(body), "Cache-Control": "private, no-cache"})


@router.get("/{job_id}")
def get_job(job_id: str, request: Request, ctx: AnyMember, runtime: RuntimeDep) -> Response:
    """GET /jobs/{id}: the job page in one call (JobDetail)."""
    kind = _kind_of(job_id, ctx.tenant.id)
    found = detail.build(runtime, ctx, kind)
    if found is None:
        raise not_found()
    return _answer(request, found)


@router.patch("/{job_id}")
def patch_job(job_id: str, body: JobPatch, ctx: OwnerOrAdmin, runtime: RuntimeDep, jobs: JobsDep) -> Response:
    """PATCH /jobs/{id}: change the switch, the name, the settings or what the helper asks; the answer is the fresh JobDetail. A value that is not allowed is refused before anything is written."""
    kind = _kind_of(job_id, ctx.tenant.id)
    token, tenant_id = ctx.principal.token, ctx.tenant.id
    current = listing.read_one(runtime, token, tenant_id, kind)
    if current is None:
        raise not_found()
    sent = body.model_fields_set
    # 1. check everything before the first write
    values = catalogue.clean(kind, body.settings) if body.settings else {}
    if body.finds_out:
        _finds_out_ok(kind, body.finds_out)
    rename = "name" in sent
    new_name = (body.name or "").strip()
    if rename and len(new_name) > MAX_NAME:
        raise _name_invalid()
    switch = _wants_switch(kind, body.enabled, current)
    if (rename or body.finds_out) and jobs.trust is None:
        raise ApiError(503, "jobs_unavailable", "Jobs are not available on this system.")
    # 2. write: the settings (the likeliest to need the second factor), the switch, then the name and what it asks
    if values:
        catalogue.apply(kind, catalogue.Env(runtime=runtime, ctx=ctx), values)
    if switch:
        control.set_enabled(runtime, token, tenant_id, kind, bool(body.enabled))   # always asked, not only on a change: `enabled` is false while ANY rule is off, and a pause must stop the ones still on
    if (rename or body.finds_out) and jobs.trust is not None:
        store = jobs.trust
        meta_id = uuid.UUID(str(_refused(lambda: store.meta_ensure(token, tenant_id, kind))["id"]))
        if rename:
            _refused(lambda: store.meta_set_name(token, tenant_id, meta_id, new_name or None))
        if body.finds_out:
            given = dict(body.finds_out)
            _refused(lambda: store.meta_set_finds_out(token, tenant_id, meta_id, given))
    fresh = detail.build(runtime, ctx, kind)
    if fresh is None:
        raise not_found()
    return _json(fresh)


def _switch(job_id: str, ctx: Any, runtime: Runtime, enabled: bool) -> Response:
    kind = _kind_of(job_id, ctx.tenant.id)
    token, tenant_id = ctx.principal.token, ctx.tenant.id
    current = listing.read_one(runtime, token, tenant_id, kind)
    if current is None:
        raise not_found()
    if _wants_switch(kind, enabled, current):
        control.set_enabled(runtime, token, tenant_id, kind, enabled)
    job = listing.read_one(runtime, token, tenant_id, kind)
    if job is None:
        raise not_found()
    items = needs_mod.items_of(runtime, token, tenant_id)
    return _json(listing.overlay(job, listing.names_of(runtime, token, tenant_id), needs_mod.count_by_job(items)))


@router.post("/{job_id}/pause")
def pause_job(job_id: str, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> Response:
    """POST /jobs/{id}/pause: the same as PATCH {enabled: false}; answers the Job. Never needs the second factor."""
    return _switch(job_id, ctx, runtime, False)


@router.post("/{job_id}/resume")
def resume_job(job_id: str, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> Response:
    """POST /jobs/{id}/resume: the same as PATCH {enabled: true}; turns on what the owner approved before, never creates an approval; answers the Job."""
    return _switch(job_id, ctx, runtime, True)


__all__ = ["router"]
