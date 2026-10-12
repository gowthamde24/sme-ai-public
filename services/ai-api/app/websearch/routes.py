"""Two routes for the web research tools under /v1/tenants/{tenant_id} (job BP, ADR 0078).

  GET  /research/status     which web tools are switched on, and today's use against each daily limit (Owner and Admin)
  POST /places/confirm      the owner confirms a shop found on the map: a company and a lead are made from the details THE OWNER TYPES, with the place ID as the only thing kept from Google (Owner, Admin, Sales)

Authorization, in order: a valid JWT (401); membership of the tenant in the PATH (404); a role (403); then the database decides again (row-level security on companies and leads). Nothing here calls a provider:
the search happened in the assistant, and what Google's terms let us keep is the place ID. The confirm is idempotent: the company and the lead have ids derived from the tenant and the place ID, so a retry
(or a double tap) returns the same two rows.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.auth.deps import OwnerOrAdmin, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import CompanyCreate, LeadCreate
from app.errors import ApiError
from app.tenancy.models import Role
from app.websearch.places import PLACE_ID

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["research"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]

# the tool a card of the app belongs to -> the name its use is counted under
TOOL_MODELS = {"web_search": "web-search", "read_page": "web-page", "find_retailers": "places-search", "metal_prices": "metal-price"}
_NS = uuid.UUID("5f0e2f0e-7c1d-4c55-9a3e-0b6f5b7a9d11")
SOURCE_PREFIX = "places:"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToolStatusOut(_Strict):
    enabled: bool
    # today's calls and the daily limit; null when the tool is off or the limit is unknown
    used_today: int | None
    daily_limit: int | None


class ResearchStatusOut(_Strict):
    tools: dict[Literal["web_search", "read_page", "find_retailers", "metal_prices"], ToolStatusOut]


Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ConfirmPlaceIn(_Strict):
    # the place ID of the card the owner confirmed (the only thing kept from Google)
    place_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=90)]
    # everything below is typed by the owner, not copied from the map
    company_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    city: Text | None = None
    region: Text | None = None


class ConfirmPlaceOut(_Strict):
    company_id: uuid.UUID
    lead_id: uuid.UUID
    # false when this place was already confirmed (the same two rows come back)
    created: bool


@router.get("/research/status", response_model=ResearchStatusOut)
def research_status(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> ResearchStatusOut:
    """Which web tools this installation has switched on, and how much of each daily limit this workspace has used today."""
    enabled = runtime.research_web.enabled() if runtime.research_web is not None else {}
    usage = runtime.research_usage.usage_today(ctx.principal.token, ctx.tenant.id) if runtime.research_usage is not None and any(enabled.values()) else {}
    tools: dict[str, ToolStatusOut] = {}
    for tool, model in TOOL_MODELS.items():
        on = bool(enabled.get(tool))
        used = usage.get(model) if on else None
        tools[tool] = ToolStatusOut(enabled=on, used_today=used["used"] if used else None, daily_limit=used["cap"] if used else None)
    return ResearchStatusOut.model_validate({"tools": tools})


@router.post("/places/confirm", response_model=ConfirmPlaceOut)
def confirm_place(body: ConfirmPlaceIn, ctx: SalesPlus, runtime: RuntimeDep, response: Response) -> ConfirmPlaceOut:
    """Make a company and a lead from a shop the owner found on the map and decided to keep. The name and city are what the owner typed; the lead's source is `places:<place ID>`."""
    if not PLACE_ID.match(body.place_id):
        raise ApiError(422, "validation_error", "Invalid input.")
    company_id = uuid.uuid5(_NS, f"{ctx.tenant.id}:company:{body.place_id}")
    lead_id = uuid.uuid5(_NS, f"{ctx.tenant.id}:lead:{body.place_id}")
    company = CompanyCreate(id=company_id, name=body.company_name, city=body.city, region=body.region, country="India")
    lead = LeadCreate(id=lead_id, company_id=company_id, source=f"{SOURCE_PREFIX}{body.place_id}")
    token = ctx.principal.token
    _, company_created = runtime.crm.create_row(token, "companies", ctx.tenant.id, company.model_dump(mode="json"))
    _, lead_created = runtime.crm.create_row(token, "leads", ctx.tenant.id, lead.model_dump(mode="json"))
    response.status_code = 201 if (company_created or lead_created) else 200
    return ConfirmPlaceOut(company_id=company_id, lead_id=lead_id, created=company_created or lead_created)
