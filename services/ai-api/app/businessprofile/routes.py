"""The business profile under /v1/tenants/{tenant_id} (job CA, ADR 0081): the shop's own GSTIN.

  GET /business-profile    every member
  PUT /business-profile    Owner or Admin, second factor. `{"gstin": "27AAPFU0939F1ZV"}` sets it (spaces, dashes and lower case are forgiven), `{"gstin": null}` clears it

A number that is not a well-formed GSTIN (state code, PAN shape, check character) is a 422; the database checks it again. Well-formed is all that is checked: it does not say the business is registered or active.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from app import gstin as gstin_module
from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.businessprofile.repository import BusinessProfileRepository
from app.crm.models import Gstin
from app.errors import ApiError
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["business"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]


class BusinessProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gstin: Gstin | None  # required: an empty body must not clear it by accident


class BusinessProfileOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gstin: str | None
    # the state or territory the number's first two digits name (null when there is no number)
    state: str | None


def _out(gstin: str | None) -> BusinessProfileOut:
    return BusinessProfileOut(gstin=gstin, state=gstin_module.state_of(gstin) if gstin else None)


def _repo(runtime: Runtime) -> BusinessProfileRepository:
    if runtime.business_profile is None:
        raise ApiError(503, "business_profile_unavailable", "The business profile is not available right now.")
    return runtime.business_profile


@router.get("/business-profile", response_model=BusinessProfileOut)
def get_profile(ctx: AnyMember, runtime: RuntimeDep) -> BusinessProfileOut:
    row = _repo(runtime).get(ctx.principal.token, ctx.tenant.id)
    return _out(row.get("gstin"))


@router.put("/business-profile", response_model=BusinessProfileOut)
def put_profile(body: BusinessProfileIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> BusinessProfileOut:
    done = _repo(runtime).set_gstin(ctx.principal.token, ctx.tenant.id, body.gstin)
    return _out(done.get("gstin"))


__all__ = ["router"]
