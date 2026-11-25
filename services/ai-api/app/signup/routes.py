"""Opening sign-up (docs/contracts/signup.md). Off (404) unless SIGNUP_OPEN is on; the database's own switch (`signup.settings.open`) decides whether anything is granted.

  GET  /v1/signup/status                          any signed-in person   what is done and what is missing
  POST /v1/signup/consent                         any signed-in person   the terms / privacy version accepted
  POST /v1/signup/phone/start                     any signed-in person   send a 6-digit code to a phone
  POST /v1/signup/phone/verify                    any signed-in person   prove the phone with the code
  POST /v1/tenants/{t}/billing/trial-claim        Owner                  the one-time trial credit (every check is in the database)

NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

# ruff: noqa: E501

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import not_found
from app.hardening.clientip import client_ip
from app.signup.models import (
    ConsentIn,
    ConsentOut,
    PhoneStartIn,
    PhoneStartOut,
    PhoneVerifyIn,
    PhoneVerifyOut,
    StatusOut,
    TrialClaimOut,
)
from app.signup.service import SignupService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/signup", tags=["signup"])
claim_router = APIRouter(prefix="/v1/tenants/{tenant_id}/billing", tags=["signup"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


def _service(runtime: Runtime) -> SignupService:
    if runtime.signup is None:
        raise not_found()
    return runtime.signup  # type: ignore[no-any-return]


@router.get("/status", response_model=StatusOut)
def status(principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).status(principal.token)


@router.post("/consent", response_model=ConsentOut)
def consent(body: ConsentIn, principal: PrincipalDep, runtime: RuntimeDep) -> ConsentOut:
    _service(runtime).consent(principal.token, body.kind, body.version)
    return ConsentOut()


@router.post("/phone/start", response_model=PhoneStartOut, response_model_exclude_none=True)
def phone_start(
    body: PhoneStartIn, request: Request, principal: PrincipalDep, runtime: RuntimeDep
) -> dict[str, Any]:
    service = _service(runtime)
    ip = client_ip(request.scope, service.proxy_hops)
    return service.phone_start(
        principal.token, principal.user_id, body.phone, ip if ip != "unknown" else None
    )


@router.post("/phone/verify", response_model=PhoneVerifyOut)
def phone_verify(
    body: PhoneVerifyIn, principal: PrincipalDep, runtime: RuntimeDep
) -> PhoneVerifyOut:
    _service(runtime).phone_verify(principal.token, principal.user_id, body.code)
    return PhoneVerifyOut()


@claim_router.post("/trial-claim", response_model=TrialClaimOut)
def trial_claim(request: Request, ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    ip = client_ip(request.scope, service.proxy_hops)
    return service.claim(ctx.principal.token, ctx.tenant.id, ip if ip != "unknown" else None)
