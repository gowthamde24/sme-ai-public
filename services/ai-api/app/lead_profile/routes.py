"""The profile of a lead (job EE, contract-context-sources.md B3): fix a field in one tap, mark a lead opened, let the model read new leads.

  PATCH /tenants/{t}/leads/{lead}/profile     Owner, Admin, Sales   body: any of need, quantity, area, city, budget, timeline, campaign, urgency, language, junk (null clears) -> the lead with its profile
  POST  /tenants/{t}/leads/{lead}/seen        Owner, Admin, Sales   the caller has opened the lead (no longer "new" for them) -> 204
  POST  /tenants/{t}/leads/profile/normalise  Owner, Admin, Sales   body {lead_ids: [1..10]} -> {improved, skipped}; spends the AI allowance; refused for schools

The list and the one-lead read (`GET /leads`, `GET /leads/{id}`) are the CRM routes; they carry `profile` and `is_new`."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import LeadOut, parse_uuid
from app.errors import ApiError, not_found
from app.lead_profile.models import NormaliseIn, NormaliseOut, ProfileFix
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["lead-profile"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Writer = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]


def _service(runtime: Runtime) -> Any:
    if runtime.lead_profiles is None:
        raise ApiError(503, "lead_profile_unavailable", "This is not available on this system.")
    return runtime.lead_profiles


def _lead_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


@router.patch("/leads/{lead_id}/profile", response_model=LeadOut)
def fix_profile(lead_id: str, body: ProfileFix, ctx: Writer, runtime: RuntimeDep) -> Any:
    return _service(runtime).fix(ctx, _lead_id(lead_id), body.model_dump(mode="json", exclude_unset=True))


@router.post("/leads/{lead_id}/seen", status_code=204)
def mark_seen(lead_id: str, ctx: Writer, runtime: RuntimeDep) -> Response:
    _service(runtime).open(ctx, _lead_id(lead_id))
    return Response(status_code=204)


@router.post("/leads/profile/normalise", response_model=NormaliseOut)
def normalise(body: NormaliseIn, ctx: Writer, runtime: RuntimeDep) -> Any:
    return _service(runtime).normalise(runtime, ctx, list(body.lead_ids))
