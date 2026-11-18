"""A business's own phone number, under /v1/tenants/{tenant_id}/phone-line (planner, 18 Nov 2026):

  GET    /phone-line/available?pattern=  Owner, Admin   the numbers on offer (nothing is rented by looking)
  GET    /phone-line                     any member      {state: none|ready, number, inbound_on, live}
  POST   /phone-line                     Owner + 2FA     {number} take one (needs the business's KYC accepted; one per business): rented, recorded, inbound OFF
  DELETE /phone-line                     Owner + 2FA     give it back (the provider first, then the record)
Refusals: 409 kyc_not_accepted | already_has_number | number_not_available, 502 number_provider_unavailable, 503 numbers_unavailable.
NOTE: no `from __future__ import annotations` here (request objects are attached at registration time)."""

# ruff: noqa: E501

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.phone_numbers.models import AvailableNumbersOut, LineOut, TakeIn
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/phone-line", tags=["phone-line"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime):  # type: ignore[no-untyped-def]
    if runtime.phone_numbers is None:
        raise ApiError(503, "numbers_unavailable", "Phone numbers are not available right now.")
    return runtime.phone_numbers


@router.get("/available", response_model=AvailableNumbersOut)
def available(ctx: OwnerAdmin, runtime: RuntimeDep, pattern: Annotated[str, Query(pattern=r"^[0-9]{0,6}$")] = "") -> AvailableNumbersOut:
    return _service(runtime).available(pattern)  # type: ignore[no-any-return]


@router.get("", response_model=LineOut)
def line(ctx: AnyMember, runtime: RuntimeDep) -> LineOut:
    return _service(runtime).line(ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]


@router.post("", response_model=LineOut)
def take(body: TakeIn, ctx: OwnerStrong, runtime: RuntimeDep) -> LineOut:
    return _service(runtime).take(ctx.principal.token, ctx.tenant.id, body.number)  # type: ignore[no-any-return]


@router.delete("", response_model=LineOut)
def give_back(ctx: OwnerStrong, runtime: RuntimeDep) -> LineOut:
    return _service(runtime).give_back(ctx.principal.token, ctx.tenant.id)  # type: ignore[no-any-return]
