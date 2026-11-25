"""Calling compliance routes (docs/contracts/call-compliance.md). Always registered; each answers 404 when the service is not built (no database).

  GET  /v1/tenants/{t}/numbers/usage-ack                      Owner, Admin   {accepted, accepted_at, version}: has the Owner accepted "how you will use this number"
  POST /v1/tenants/{t}/numbers/usage-ack                      Owner (2nd factor)   {version}: records the acceptance with the date and who
  POST /v1/tenants/{t}/contacts/{contact_id}/registered-consent   Owner, Admin (2nd factor)  {registrar_id}: the person's phone consent is held by a Consent Registrar
  POST /v1/tenants/{t}/call-complaints                        Owner, Admin   {kind, call_id?}: one more complaint about the workspace's outbound calls; the answer says warn (3) and paused (5) in 10 days
  GET  /v1/admin/compliance/abandoned-calls?hours=24          staff          the abandoned-call rate and the businesses with complaints
NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

# ruff: noqa: E501

import re
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.admin.routes import _guard
from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.compliance.service import REGISTRAR_ID, ComplianceService
from app.errors import not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["compliance"])
admin_router = APIRouter(prefix="/v1/admin/compliance", tags=["admin"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> ComplianceService:
    if getattr(runtime, "compliance", None) is None:
        raise not_found()
    return runtime.compliance  # type: ignore[no-any-return]


class UsageAckIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: str = Field(pattern=r"^[a-z0-9._-]{1,30}$")


class RegisteredConsentIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    registrar_id: str

    @field_validator("registrar_id")
    @classmethod
    def _shape(cls, value: str) -> str:
        if not re.fullmatch(REGISTRAR_ID, value):
            raise ValueError("invalid")
        return value


class ComplaintIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    kind: Literal["to_business", "telecom_provider", "regulator"]
    call_id: uuid.UUID | None = None


@router.get("/numbers/usage-ack")
def usage_ack(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).usage_ack(ctx.principal.token, ctx.tenant.id)


@router.post("/numbers/usage-ack", status_code=201)
def accept_usage(body: UsageAckIn, ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).accept_usage(ctx.principal.token, ctx.tenant.id, body.version)


@router.post("/contacts/{contact_id}/registered-consent", status_code=201)
def registered_consent(contact_id: uuid.UUID, body: RegisteredConsentIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> dict[str, bool]:
    _service(runtime).register_consent(ctx.principal.token, ctx.tenant.id, contact_id, body.registrar_id)
    return {"recorded": True}


@router.post("/call-complaints", status_code=201)
def record_complaint(body: ComplaintIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).record_complaint(ctx.principal.token, ctx.tenant.id, body.kind, body.call_id)


@admin_router.get("/abandoned-calls")
def abandoned_calls(principal: PrincipalDep, runtime: RuntimeDep, hours: Annotated[int, Query(ge=1, le=168)] = 24) -> dict[str, Any]:
    return _guard(lambda: _service(runtime).abandoned_calls(principal.token, hours))
