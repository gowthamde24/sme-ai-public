"""Plans and billing (job DI, ADR 0092). The contract is packages/contracts/billing.* and docs/contracts/plans-billing.md.

  GET  /v1/plans                                  the plans catalogue (any signed-in user). Prices are null until the owner of the product sets them.
  GET  /v1/tenants/{tenant_id}/billing            the plan in force, the subscription, the period, both meters, the notices (Owner, Admin)
  GET  /v1/tenants/{tenant_id}/billing/usage      the period, the meters and the notices only (Owner, Admin)
  POST /v1/tenants/{tenant_id}/billing/trial      start the 30-day trial with a payment method on file; nothing is charged (Owner, second factor)
  POST /v1/tenants/{tenant_id}/billing/cancel     cancel: during the trial no charge ever; an active plan ends at the end of the paid period (Owner, second factor)

A meter shows counts and percentages only: never the AI's rupees or tokens (AI is included under fair use).

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.billing.models import BillingOut, PlansOut, TrialStartIn, UsageViewOut
from app.billing.service import BillingService
from app.errors import ApiError
from app.tenancy.models import Role

plans_router = APIRouter(prefix="/v1/plans", tags=["billing"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}/billing", tags=["billing"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> BillingService:
    if runtime.billing is None:
        raise ApiError(503, "billing_unavailable", "Plans and billing are not available right now.")
    return runtime.billing


@plans_router.get("", response_model=PlansOut)
def list_plans(principal: PrincipalDep, runtime: RuntimeDep) -> PlansOut:
    return PlansOut.model_validate(_service(runtime).plans(principal.token))


@router.get("", response_model=BillingOut)
def get_billing(ctx: OwnerAdmin, runtime: RuntimeDep) -> BillingOut:
    return BillingOut.model_validate(_service(runtime).billing(ctx.principal.token, ctx.tenant.id))


@router.get("/usage", response_model=UsageViewOut)
def get_usage(ctx: OwnerAdmin, runtime: RuntimeDep) -> UsageViewOut:
    return UsageViewOut.model_validate(_service(runtime).usage(ctx.principal.token, ctx.tenant.id))


@router.post("/trial", response_model=BillingOut)
def start_trial(body: TrialStartIn, ctx: OwnerStrong, runtime: RuntimeDep) -> BillingOut:
    return BillingOut.model_validate(_service(runtime).start_trial(ctx.principal.token, ctx.tenant.id, body.plan_id, body.checkout_ref))


@router.post("/cancel", response_model=BillingOut)
def cancel(ctx: OwnerStrong, runtime: RuntimeDep) -> BillingOut:
    return BillingOut.model_validate(_service(runtime).cancel(ctx.principal.token, ctx.tenant.id))
