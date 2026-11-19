"""Pricing v3 (the owner's plans and pricing of 19 Nov 2026), all in rupees: Pay as you go / Pro / Business, ONE wallet with a usage line per feature, optional spending limits, an optional automatic top-up,
the upgrade hint, the 80% / 100% warnings, the queue of calls. Off (404) unless PRICING_V3 is on. Billing v2 and its routes are untouched. Every tenant route is under /billing, which the read-only rule always lets
through (a workspace that is read-only can still look at its wallet, add money and choose a plan). NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

# ruff: noqa: E501

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.billing.errors import NotSupportedError
from app.errors import ApiError, not_found
from app.pricing.models import FreeStartOut, InvoicesOut, OrderConfirmIn, OrderOut
from app.pricing.service import OrderRefusedError, PaymentNotVerifiedError
from app.pricing.v3_models import (
    AutoTopupIn,
    AutoTopupOut,
    CatalogueV3Out,
    ChangeQuoteV3Out,
    ChangeV3In,
    CheckoutV3Out,
    EstimateV3In,
    EstimateV3Out,
    Feature,
    LedgerOut,
    LimitIn,
    LimitOut,
    OrderV3In,
    SubscribeV3In,
    WalletOut,
)
from app.pricing.v3_service import PricingV3Service
from app.tenancy.models import Role

public_router = APIRouter(prefix="/v1/pricing/v3", tags=["pricing-v3"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}/billing/v3", tags=["pricing-v3"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> PricingV3Service:
    if runtime.pricing_v3 is None:
        raise not_found()
    return runtime.pricing_v3  # type: ignore[no-any-return]


def _unavailable() -> ApiError:
    return ApiError(503, "billing_unavailable", "The payment page is not available. Try again in a minute.")


@public_router.get("", response_model=CatalogueV3Out)
def catalogue(principal: PrincipalDep, runtime: RuntimeDep) -> CatalogueV3Out:
    """The plans: Pay as you go, Pro (most popular), Business, with their prices, minutes, Lead Finder searches and numbers; GST, the free start, the price of an extra number."""
    return _service(runtime).catalogue(principal.token)


@router.get("/wallet", response_model=WalletOut)
def wallet(ctx: AnyMember, runtime: RuntimeDep) -> WalletOut:
    """ONE rupee wallet: the balance, the plan, a usage line per feature (calls, Lead Finder, numbers, WhatsApp, AI actions), the limits, the warnings in force, the calls waiting, the upgrade hint, the access state."""
    return _service(runtime).wallet(ctx.principal.token, ctx.tenant.id)


@router.get("/ledger", response_model=LedgerOut)
def ledger(ctx: OwnerAdmin, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> LedgerOut:
    """What was charged, newest first: one line per call, search, number-month and WhatsApp message."""
    return _service(runtime).ledger(ctx.principal.token, ctx.tenant.id, limit)


@router.put("/limits/{feature}", response_model=LimitOut)
def set_limit(feature: Feature, body: LimitIn, ctx: Owner, runtime: RuntimeDep) -> LimitOut:
    """The OPTIONAL spending limit of one feature (calls, lead_finder, numbers, whatsapp) for the month of the plan; `limit_paise: null` takes it away. At 80% and 100% a warning is given; at 100% the feature stops
    (a call waits in the queue, a paid search is refused with 409 `spending_limit_reached`)."""
    return _service(runtime).limit_set(ctx.principal.token, ctx.tenant.id, feature, body.limit_paise)


@router.put("/auto-topup", response_model=AutoTopupOut)
def set_auto_topup(body: AutoTopupIn, ctx: OwnerStrong, runtime: RuntimeDep) -> AutoTopupOut:
    """The OPTIONAL automatic top-up: `amount_paise` is added whenever the wallet falls under `below_paise`, never more than `monthly_limit_paise` in a month. Owner, second factor."""
    return _service(runtime).auto_topup_set(ctx.principal.token, ctx.tenant.id, body)


@router.post("/free-start", response_model=FreeStartOut)
def free_start(ctx: Owner, runtime: RuntimeDep) -> FreeStartOut:
    """The free start (₹50 of usage, no card): once per business."""
    return _service(runtime).free_start(ctx.principal.token, ctx.tenant.id)


@router.post("/estimate", response_model=EstimateV3Out)
def estimate(body: EstimateV3In, ctx: OwnerAdmin, runtime: RuntimeDep) -> EstimateV3Out:
    return _service(runtime).estimate(ctx.principal.token, ctx.tenant.id, body)


@router.post("/checkout", response_model=CheckoutV3Out)
def checkout(body: ChangeV3In, ctx: Owner, runtime: RuntimeDep) -> CheckoutV3Out:
    """Step 1 of choosing a plan: what the browser opens the provider's checkout with (nothing is charged)."""
    try:
        return _service(runtime).checkout(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval)
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/subscribe", response_model=WalletOut)
def subscribe(body: SubscribeV3In, ctx: OwnerStrong, runtime: RuntimeDep) -> WalletOut:
    """Step 2: the checkout's reference. The plan starts for a month or a year (launch prices locked 12 months) and the first invoice (price + 18% GST) is written, once per payment. Owner, second factor."""
    try:
        return _service(runtime).subscribe(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval, body.checkout_ref)
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/change-quote", response_model=ChangeQuoteV3Out)
def change_quote(body: ChangeV3In, ctx: Owner, runtime: RuntimeDep) -> ChangeQuoteV3Out:
    """What changing plan costs now (prorated by the days left; nothing changes)."""
    try:
        return _service(runtime).change_quote(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval)
    except OrderRefusedError:
        raise ApiError(422, "plan_unknown", "That plan does not exist.") from None


@router.post("/change", response_model=WalletOut)
def change_plan(body: ChangeV3In, ctx: OwnerStrong, runtime: RuntimeDep) -> WalletOut:
    """Apply a change that costs nothing (a downgrade): the plan changes now, the unused share goes to the wallet, the data stays. 422 `payment_required` when something is due (use an order)."""
    try:
        return _service(runtime).change(ctx.principal.token, ctx.tenant.id, body.plan_id, body.interval)
    except OrderRefusedError:
        raise ApiError(422, "payment_required", "This change has an amount to pay. Pay it first.") from None


@router.post("/plan/cancel", response_model=WalletOut)
def cancel_plan(ctx: OwnerStrong, runtime: RuntimeDep) -> WalletOut:
    """Cancel at the end of the paid period (nothing is refunded; the data stays). Owner, second factor."""
    try:
        return _service(runtime).cancel(ctx.principal.token, ctx.tenant.id)
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/orders", response_model=OrderOut)
def create_order(body: OrderV3In, ctx: Owner, runtime: RuntimeDep) -> OrderOut:
    """A one-time payment on the provider's page: a wallet top-up (₹100 to ₹1,00,000), the pay-as-you-go monthly fee, or the prorated amount of an upgrade. The amount is fixed by the stored order."""
    try:
        return _service(runtime).create_order(ctx.principal.token, ctx.tenant.id, body)
    except OrderRefusedError:
        raise ApiError(422, "order_refused", "That amount or plan cannot be paid for.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/orders/{order_id}/confirm", response_model=WalletOut)
def confirm_order(order_id: Annotated[str, Path(pattern=r"^[A-Za-z0-9_.:-]{3,100}$")], body: OrderConfirmIn, ctx: OwnerStrong, runtime: RuntimeDep) -> WalletOut:
    """The checkout returned its payment id and signature: checked, then the order is settled once. Safe to repeat. Owner, second factor."""
    try:
        return _service(runtime).confirm_order(ctx.principal.token, ctx.tenant.id, order_id, body)
    except PaymentNotVerifiedError:
        raise ApiError(402, "payment_not_verified", "The payment could not be verified. Nothing was added.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.get("/invoices", response_model=InvoicesOut)
def invoices(ctx: OwnerAdmin, runtime: RuntimeDep) -> InvoicesOut:
    return _service(runtime).invoices(ctx.principal.token, ctx.tenant.id)
