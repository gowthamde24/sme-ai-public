"""Billing v2 (the owner's final pricing of 13 Nov 2026), all in rupees: GET /v1/pricing (any signed-in user), GET /billing/balance (any member), POST /billing/free-start (Owner), POST /billing/estimate (Owner, Admin).
Off (404) unless PRICING_V2 is on: on in staging, off in production. NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

# ruff: noqa: E501

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import not_found
from app.pricing.models import BalanceOut, CatalogueOut, EstimateIn, EstimateOut, FreeStartOut
from app.pricing.service import PricingService
from app.tenancy.models import Role

public_router = APIRouter(prefix="/v1/pricing", tags=["pricing"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}/billing", tags=["pricing"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


def _service(runtime: Runtime) -> PricingService:
    if runtime.pricing is None:
        raise not_found()
    return runtime.pricing  # type: ignore[no-any-return]


@public_router.get("", response_model=CatalogueOut)
def catalogue(principal: PrincipalDep, runtime: RuntimeDep) -> CatalogueOut:
    return _service(runtime).catalogue(principal.token)


@router.get("/balance", response_model=BalanceOut)
def balance(ctx: AnyMember, runtime: RuntimeDep) -> BalanceOut:
    return _service(runtime).balance(ctx.principal.token, ctx.tenant.id)


@router.post("/free-start", response_model=FreeStartOut)
def free_start(ctx: Owner, runtime: RuntimeDep) -> FreeStartOut:
    """The free start (₹50 of usage, no card): once per business. The "once per verified phone" check runs when the sign-up passes the verified phone's keyed hash (the web's phone step)."""
    return _service(runtime).free_start(ctx.principal.token, ctx.tenant.id)


@router.post("/estimate", response_model=EstimateOut)
def estimate(body: EstimateIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> EstimateOut:
    return _service(runtime).estimate(ctx.principal.token, ctx.tenant.id, body)


_ = uuid
