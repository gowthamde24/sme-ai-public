"""Billing v2 (the owner's final pricing of 13 Nov 2026), all in rupees: GET /v1/pricing (any signed-in user), GET /billing/balance (any member), POST /billing/free-start (Owner), POST /billing/estimate (Owner, Admin).
Off (404) unless PRICING_V2 is on: on in staging, off in production. NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

# ruff: noqa: E501

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.billing.errors import NotSupportedError
from app.errors import ApiError, not_found
from app.pricing.models import (
    BalanceOut,
    CatalogueOut,
    ChangeQuoteIn,
    ChangeQuoteOut,
    EstimateIn,
    EstimateOut,
    FreeStartOut,
    InvoicesOut,
    OrderConfirmIn,
    OrderIn,
    OrderOut,
    SubscribeIn,
    SubscriptionCheckoutIn,
    SubscriptionCheckoutOut,
)
from app.pricing.service import OrderRefusedError, PaymentNotVerifiedError, PricingService
from app.tenancy.models import Role

public_router = APIRouter(prefix="/v1/pricing", tags=["pricing"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}/billing", tags=["pricing"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


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


def _unavailable() -> ApiError:
    return ApiError(503, "billing_unavailable", "The payment page is not available. Try again in a minute.")


@router.post("/subscription-checkout", response_model=SubscriptionCheckoutOut)
def subscription_checkout(body: SubscriptionCheckoutIn, ctx: Owner, runtime: RuntimeDep) -> SubscriptionCheckoutOut:
    """Step 1 of subscribing to a plan: what the browser opens the provider's checkout with (nothing is charged). The fake provider answers no key and no subscription."""
    try:
        return _service(runtime).subscription_checkout(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval)
    except OrderRefusedError:
        raise ApiError(422, "plan_unknown", "That plan does not exist.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/subscribe", response_model=BalanceOut)
def subscribe(body: SubscribeIn, ctx: OwnerStrong, runtime: RuntimeDep) -> BalanceOut:
    """Step 2: the checkout's reference. The provider checks it, then the plan starts for a month or a year and the first invoice (price + 18% GST) is written, once per payment. Owner, second factor."""
    try:
        return _service(runtime).subscribe(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval, body.checkout_ref)
    except OrderRefusedError:
        raise ApiError(422, "plan_unknown", "That plan does not exist.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/change-quote", response_model=ChangeQuoteOut)
def change_quote(body: ChangeQuoteIn, ctx: Owner, runtime: RuntimeDep) -> ChangeQuoteOut:
    """What changing plan costs now (prorated by the days left; nothing changes). An upgrade is paid with an order (`purpose: plan_change`); a downgrade is free and POST /billing/change applies it."""
    try:
        return _service(runtime).change_quote(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval)
    except OrderRefusedError:
        raise ApiError(422, "plan_unknown", "That plan does not exist.") from None


@router.post("/change", response_model=BalanceOut)
def change_plan_free(body: ChangeQuoteIn, ctx: OwnerStrong, runtime: RuntimeDep) -> BalanceOut:
    """Apply a change that costs nothing (a downgrade): the plan changes now, the unused share goes to the balance, the data stays. 422 `payment_required` when something is due (use an order)."""
    try:
        return _service(runtime).downgrade(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval)
    except OrderRefusedError:
        raise ApiError(422, "payment_required", "This change has an amount to pay. Pay it first.") from None


@router.post("/plan/cancel", response_model=BalanceOut)
def cancel_plan(ctx: OwnerStrong, runtime: RuntimeDep) -> BalanceOut:
    """Cancel at the end of the paid period (nothing is refunded; the data stays). Owner, second factor."""
    try:
        return _service(runtime).cancel(ctx.principal.token, ctx.tenant.id)
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/orders", response_model=OrderOut)
def create_order(body: OrderIn, ctx: Owner, runtime: RuntimeDep) -> OrderOut:
    """A one-time payment on the provider's page: a balance top-up (₹100 to ₹1,00,000), the pay-as-you-go monthly fee, or the prorated amount of an upgrade. The amount is fixed by the stored order, never by the caller later."""
    try:
        return _service(runtime).create_order(ctx.principal.token, ctx.tenant.id, body)
    except OrderRefusedError:
        raise ApiError(422, "order_refused", "That amount or plan cannot be paid for.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/orders/{order_id}/confirm", response_model=BalanceOut)
def confirm_order(order_id: Annotated[str, Path(pattern=r"^[A-Za-z0-9_.:-]{3,100}$")], body: OrderConfirmIn, ctx: OwnerStrong, runtime: RuntimeDep) -> BalanceOut:
    """The checkout returned its payment id and signature: checked, then the order is settled once (the balance credited, the fee recorded or the plan changed). Safe to repeat. Owner, second factor."""
    try:
        return _service(runtime).confirm_order(ctx.principal.token, ctx.tenant.id, order_id, body.payment_id, body.signature)
    except PaymentNotVerifiedError:
        raise ApiError(402, "payment_not_verified", "The payment could not be verified. Nothing was added.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.get("/gst-invoices", response_model=InvoicesOut)
def invoices(ctx: OwnerAdmin, runtime: RuntimeDep) -> InvoicesOut:
    return _service(runtime).invoices(ctx.principal.token, ctx.tenant.id)


_ = uuid
