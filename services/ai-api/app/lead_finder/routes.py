"""The Lead Finder under /v1/tenants/{tenant_id} (ADR 0119). The contract is docs/contracts/lead-finder.md.

  GET  /lead-finder/availability                 Owner, Admin, Sales: is it here at all (a school: no), and which source (fixture | places)
  GET  /lead-finder/settings                     Owner, Admin, Sales: the bar, the daily call cap, the calling hours, the search caps
  PUT  /lead-finder/settings                     Owner, Admin
  POST /lead-finder/plan                         Owner, Admin, Sales: the owner's words (or a query) -> the PLAN CARD (nothing is searched yet)
  POST /lead-finder/searches/{id}/approve        Owner, Admin: the OK; the search runs (fixture, or Google Places in Owner Test only) -> the RESULT CARD
  POST /lead-finder/searches/{id}/cancel         Owner, Admin
  GET  /lead-finder/searches, /lead-finder/searches/{id}
  GET  /prospects?status=&search_id=&limit=&cursor=     the Prospects tab (best fit first)
  GET  /prospects/stats?search_id=
  GET  /prospects/{id}
  POST /prospects/actions                        Owner, Admin, Sales: call | later | skip | not_interested | do_not_call, for up to 50 at once
  POST /prospects/redecide                       Owner, Admin, Sales: decide again the ones that waited for the hours or the cap
  POST /prospects/{id}/simulated-call            Owner, Admin: the qualifying call IN THE SIMULATOR (nothing is dialled)
  GET  /prospects/{id}/quote-draft               Owner, Admin, Sales: the PREVIEW of the draft quote a qualified call suggests (nothing is stored)
  POST /prospects/{id}/quote-draft               Owner, Admin, with the second factor: one enquiry on the call's lead + a DRAFT quote at the Owner's catalogue prices (approved on the quote page)

A business type without the module (a school) gets 403 `lead_finder_not_available` from every one of them.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.lead_finder import quote_draft
from app.lead_finder.models import (
    ActionsIn,
    ActionsOut,
    AvailabilityOut,
    PlanIn,
    ProspectListOut,
    ProspectOut,
    ProspectStatus,
    QuoteDraftIn,
    QuoteDraftOut,
    QuoteDraftPreviewOut,
    RedecideOut,
    SearchListOut,
    SearchOut,
    SettingsIn,
    SettingsOut,
    SimulatedCallOut,
    SimulateIn,
    StatsOut,
)
from app.lead_finder.service import LeadFinderService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["lead-finder"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Worker = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]


def _service(runtime: Runtime) -> LeadFinderService:
    if runtime.lead_finder is None:
        raise ApiError(503, "lead_finder_unavailable", "Finding new customers is not available right now.")
    return runtime.lead_finder


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


@router.get("/lead-finder/availability", response_model=AvailabilityOut)
def availability(ctx: Worker, runtime: RuntimeDep) -> AvailabilityOut:
    return _service(runtime).availability(ctx.principal.token, ctx.tenant.id)


@router.get("/lead-finder/settings", response_model=SettingsOut)
def get_settings(ctx: Worker, runtime: RuntimeDep) -> SettingsOut:
    return _service(runtime).settings(ctx.principal.token, ctx.tenant.id)


@router.put("/lead-finder/settings", response_model=SettingsOut)
def put_settings(body: SettingsIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> SettingsOut:
    return _service(runtime).set_settings(ctx.principal.token, ctx.tenant.id, body)


@router.post("/lead-finder/plan", response_model=SearchOut, status_code=201)
def plan(body: PlanIn, ctx: Worker, runtime: RuntimeDep) -> SearchOut:
    return _service(runtime).plan(ctx.principal.token, ctx.tenant.id, body)


@router.post("/lead-finder/searches/{search_id}/approve", response_model=SearchOut)
def approve(search_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> SearchOut:
    return _service(runtime).approve(ctx.principal.token, ctx.tenant.id, _id(search_id))


@router.post("/lead-finder/searches/{search_id}/cancel", response_model=SearchOut)
def cancel(search_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> SearchOut:
    return _service(runtime).cancel(ctx.principal.token, ctx.tenant.id, _id(search_id))


@router.get("/lead-finder/searches", response_model=SearchListOut)
def searches(ctx: Worker, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 20) -> SearchListOut:
    return _service(runtime).searches(ctx.principal.token, ctx.tenant.id, limit)


@router.get("/lead-finder/searches/{search_id}", response_model=SearchOut)
def search(search_id: str, ctx: Worker, runtime: RuntimeDep) -> SearchOut:
    return _service(runtime).search(ctx.principal.token, ctx.tenant.id, _id(search_id))


@router.get("/prospects", response_model=ProspectListOut)
def prospects(ctx: Worker, runtime: RuntimeDep, status: ProspectStatus | None = None, search_id: str | None = None,
              limit: Annotated[int, Query(ge=1, le=200)] = 50, cursor: Annotated[str | None, Query(max_length=80)] = None) -> ProspectListOut:
    return _service(runtime).prospects(ctx.principal.token, ctx.tenant.id, status, _id(search_id) if search_id else None, limit, cursor)


@router.get("/prospects/stats", response_model=StatsOut)
def stats(ctx: Worker, runtime: RuntimeDep, search_id: str | None = None) -> StatsOut:
    return _service(runtime).stats(ctx.principal.token, ctx.tenant.id, _id(search_id) if search_id else None)


@router.post("/prospects/actions", response_model=ActionsOut)
def actions(body: ActionsIn, ctx: Worker, runtime: RuntimeDep) -> ActionsOut:
    return _service(runtime).act(ctx.principal.token, ctx.tenant.id, body)


@router.post("/prospects/redecide", response_model=RedecideOut)
def redecide(ctx: Worker, runtime: RuntimeDep) -> RedecideOut:
    return _service(runtime).redecide(ctx.principal.token, ctx.tenant.id)


@router.get("/prospects/{prospect_id}", response_model=ProspectOut)
def prospect(prospect_id: str, ctx: Worker, runtime: RuntimeDep) -> ProspectOut:
    return _service(runtime).prospect(ctx.principal.token, ctx.tenant.id, _id(prospect_id))


@router.post("/prospects/{prospect_id}/simulated-call", response_model=SimulatedCallOut)
def simulated_call(prospect_id: str, body: SimulateIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> SimulatedCallOut:
    return _service(runtime).simulate_call(ctx.principal.token, ctx.tenant.id, ctx.tenant.name, _id(prospect_id), body)


@router.get("/prospects/{prospect_id}/quote-draft", response_model=QuoteDraftPreviewOut)
def quote_draft_preview(prospect_id: str, ctx: Worker, runtime: RuntimeDep) -> QuoteDraftPreviewOut:
    return quote_draft.preview(_service(runtime), runtime.quotes, ctx.principal.token, ctx.tenant.id, _id(prospect_id))


@router.post("/prospects/{prospect_id}/quote-draft", response_model=QuoteDraftOut, status_code=201)
def quote_draft_make(prospect_id: str, body: QuoteDraftIn, ctx: OwnerAdminStrong, runtime: RuntimeDep, response: Response) -> QuoteDraftOut:
    out = quote_draft.make(_service(runtime), runtime.quotes, runtime.enquiries, ctx.principal.token, ctx.tenant.id, _id(prospect_id), body)
    response.status_code = 200 if out.replayed else 201
    return out
