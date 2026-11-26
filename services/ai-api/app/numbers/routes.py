# ruff: noqa: E501
"""The number picker (28 Nov 2026; contract: reports/number-picker-contract-note.md). Numbers are shown as +91 XXXXX XXXXX with their type and NEVER a price.
  GET  /v1/tenants/{t}/numbers             the workspace's VoiceLink numbers and any claim in progress (any member)
  GET  /v1/tenants/{t}/numbers/available   numbers for sale: ?type=mobile|landline&prefix=98&page=1 (Owner or Admin); 409 numbers_unavailable with a `reason` when the picker is off for this workspace
  POST /v1/tenants/{t}/numbers/claim       {number}: buys it (OUR money), connects it, attaches it with calls OFF (Owner + second factor)
NOTE: no `from __future__ import annotations` here (request objects are attached at registration time)."""

import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.numbers.service import NumberService, PickerBlocked, display
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/numbers", tags=["numbers"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]
OwnerOrAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
Kind = Literal["mobile", "landline"]
WORDS = {
    "paused": "We cannot add numbers right now.", "not_on_plan": "Your plan does not include another number.", "already_has_number": "Your plan includes one number, and you have it.",
    "kyc_required": "Verify your business first to get a number in its name.", "daily_limit": "We cannot add numbers right now, we have told our team.", "wallet_low": "We cannot add numbers right now, we have told our team.", "number_taken": "That number was just taken. Please pick another.", "unavailable": "We cannot add numbers right now.",
}


class NumberOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID | None = None   # the phone line's own id (an AI employee is given a line by it); none while the number is still getting ready
    number: str
    display: str
    type: str
    state: str | None = None
    label: str | None = None


class NumbersOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    numbers: list[NumberOut]


class OfferOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: str
    display: str
    type: str


class AvailableOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    numbers: list[OfferOut]
    page: int
    more: bool


class ClaimIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: str
    type: Kind = "mobile"


class ClaimedOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    number: str
    display: str
    type: str
    state: str


def _service(runtime: Runtime) -> NumberService:
    if getattr(runtime, "numbers", None) is None:
        raise ApiError(503, "numbers_unavailable", "This is not available right now.", extra={"reason": "paused", "fields": ["paused"]})
    return runtime.numbers  # type: ignore[no-any-return]


def _blocked(exc: PickerBlocked) -> ApiError:
    code = "number_taken" if exc.reason == "number_taken" else "numbers_unavailable"
    return ApiError(409, code, WORDS.get(exc.reason, WORDS["unavailable"]), extra={"reason": exc.reason, "fields": [exc.reason]})


@router.get("", response_model=NumbersOut)
def my_numbers(ctx: AnyMember, runtime: RuntimeDep) -> NumbersOut:
    return NumbersOut(numbers=[NumberOut(**n) for n in _service(runtime).numbers(ctx.principal.token, ctx.tenant.id)])


@router.get("/available", response_model=AvailableOut)
def available(ctx: OwnerOrAdmin, runtime: RuntimeDep, type: Kind = "mobile", prefix: Annotated[str, Query(max_length=6)] = "", page: Annotated[int, Query(ge=1, le=50)] = 1) -> AvailableOut:
    if prefix and not re.fullmatch(r"[0-9]{1,6}", prefix):
        raise ApiError(422, "validation_error", "Use digits only.", extra={"fields": ["prefix"]})
    try:
        offers, more = _service(runtime).available(ctx.principal.token, ctx.tenant.id, type, prefix, page)
    except PickerBlocked as exc:
        raise _blocked(exc) from None
    return AvailableOut(numbers=[OfferOut(number=o.number, display=o.display, type=o.type) for o in offers], page=page, more=more)


@router.post("/claim", response_model=ClaimedOut, status_code=201)
def claim(ctx: OwnerStrong, runtime: RuntimeDep, body: ClaimIn) -> ClaimedOut:
    if not re.fullmatch(r"\+91[0-9]{10}", body.number):
        raise ApiError(422, "validation_error", "That is not a phone number we can add.", extra={"fields": ["number"]})
    store = getattr(getattr(runtime, "phone_inbound", None), "store", None)
    service = _service(runtime)
    service_alert = getattr(store, "telephony_alert", None)
    if service_alert is not None:
        service._alert = lambda detail: service_alert(False, detail)  # noqa: SLF001 - the scheduler account raises the Needs-you item
    try:
        done = service.claim(ctx.principal.token, ctx.tenant.id, body.number, body.type, email=ctx.principal.email or "", name=getattr(ctx.tenant, "name", "") or "")
    except PickerBlocked as exc:
        raise _blocked(exc) from None
    return ClaimedOut(number=done.number, display=display(done.number) if not done.display else done.display, type=done.type, state=done.state)
