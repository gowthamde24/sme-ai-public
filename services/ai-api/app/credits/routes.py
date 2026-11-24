# ruff: noqa: E501
"""The credits top-up routes (docs/contracts/credits-topup.md). On with PRICING_V2 (a 404 otherwise); money is in rupees and paise, never the word "credits".

  GET  /v1/tenants/{t}/billing/credits/topup-options              the four amounts (₹500 / ₹1,000 / ₹2,000 / ₹5,000), the custom range, GST, test or live mode (Owner, Admin)
  POST /v1/tenants/{t}/billing/credits/topups                     `{amount_rupees}` -> the checkout-ready order: order id, public key id, the total to charge (Owner)
  GET  /v1/tenants/{t}/billing/credits/topups                     the recent top-ups with their state: paid / failed / pending / abandoned (Owner, Admin)
  POST /v1/tenants/{t}/billing/credits/topups/{order}/confirm     `{payment_id, signature}` from the checkout: verified, then added once (Owner); safe to repeat
  POST /v1/tenants/{t}/billing/credits/topups/{order}/failed      `{reason}` the checkout failed or was closed (Owner); the order can still be paid later
  GET  /v1/tenants/{t}/billing/credits/statement                  every addition and deduction with the balance after each (Owner, Admin)
  GET  /v1/tenants/{t}/billing/gst-invoices/{number}              one GST invoice or credit note in full (a number like S19-2627-000001: 26-27 is the financial year) (Owner, Admin)
  POST /v1/admin/businesses/{t}/topups/{order}/refund             Stack19 staff (owner, finance): refund the UNUSED part of a top-up; needs a reason, a fresh authenticator code and an idempotency key
NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from app.admin.routes import _guard
from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.billing.errors import NotSupportedError
from app.credits.errors import AlreadyRefundedError, NotAPaidTopupError, NothingUnusedError
from app.credits.models import (
    InvoiceDetailOut,
    RefundIn,
    RefundOut,
    StatementOut,
    TopupConfirmIn,
    TopupConfirmOut,
    TopupFailedIn,
    TopupFailedOut,
    TopupOptionsOut,
    TopupOrderIn,
    TopupOrderOut,
    TopupsOut,
)
from app.credits.service import (
    CreditsService,
    RefundDeclinedError,
    RefundUnconfirmedError,
    TopupAmountInvalidError,
    TopupNotVerifiedError,
    TopupOrderUnknownError,
)
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/billing", tags=["credits"])
admin_router = APIRouter(prefix="/v1/admin", tags=["admin"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OrderId = Annotated[str, Path(pattern=r"^[A-Za-z0-9_.:-]{3,100}$")]


def _service(runtime: Runtime) -> CreditsService:
    if runtime.credits is None:
        raise not_found()
    return runtime.credits  # type: ignore[no-any-return]


def _unavailable() -> ApiError:
    return ApiError(503, "billing_unavailable", "The payment page is not available. Try again in a minute.")


@router.get("/credits/topup-options", response_model=TopupOptionsOut)
def topup_options(ctx: OwnerAdmin, runtime: RuntimeDep) -> TopupOptionsOut:
    return _service(runtime).options(ctx.principal.token)


@router.post("/credits/topups", response_model=TopupOrderOut)
def create_topup(body: TopupOrderIn, ctx: Owner, runtime: RuntimeDep) -> TopupOrderOut:
    """The order the browser's checkout pays. The amount added to the balance is the amount before GST; 18% GST is added on top and is shown separately. The amount is fixed by the stored order: a later call cannot change it."""
    try:
        return _service(runtime).create_topup(ctx.principal.token, ctx.tenant.id, body.amount_rupees)
    except TopupAmountInvalidError:
        raise ApiError(422, "topup_amount_invalid", "Choose a whole number of rupees from ₹100 to ₹1,00,000.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.get("/credits/topups", response_model=TopupsOut)
def topups(ctx: OwnerAdmin, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 20) -> TopupsOut:
    return _service(runtime).orders(ctx.principal.token, ctx.tenant.id, limit)


@router.post("/credits/topups/{order_id}/confirm", response_model=TopupConfirmOut)
def confirm_topup(order_id: OrderId, body: TopupConfirmIn, ctx: Owner, runtime: RuntimeDep) -> TopupConfirmOut:
    """The checkout returned its payment id and signature: checked here, then the balance is topped up once and the GST invoice written. Safe to repeat; the webhook may have done it already (`replayed: true`)."""
    try:
        return _service(runtime).confirm_topup(ctx.principal.token, ctx.tenant.id, order_id, body.payment_id, body.signature)
    except TopupOrderUnknownError:
        raise ApiError(404, "topup_order_unknown", "We could not find that payment.") from None
    except TopupNotVerifiedError:
        raise ApiError(402, "topup_not_verified", "We could not verify this payment, so nothing was added. If money left your account, wait a few minutes: it is added when the bank confirms.") from None
    except NotSupportedError:
        raise _unavailable() from None


@router.post("/credits/topups/{order_id}/failed", response_model=TopupFailedOut)
def topup_failed(order_id: OrderId, body: TopupFailedIn, ctx: Owner, runtime: RuntimeDep) -> TopupFailedOut:
    return _service(runtime).failed(ctx.principal.token, order_id, body.reason)


@router.get("/credits/statement", response_model=StatementOut)
def statement(
    ctx: OwnerAdmin, runtime: RuntimeDep, date_from: Annotated[date | None, Query(alias="from")] = None, date_to: Annotated[date | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50, before: Annotated[datetime | None, Query()] = None,
) -> StatementOut:
    if date_from is not None and date_to is not None and date_to < date_from:
        raise ApiError(422, "statement_dates_invalid", "The end date is before the start date.")
    return _service(runtime).statement(ctx.principal.token, ctx.tenant.id, date_from.isoformat() if date_from else None, date_to.isoformat() if date_to else None, limit, before.isoformat() if before else None)


@router.get("/gst-invoices/{number}", response_model=InvoiceDetailOut)
def invoice_detail(number: Annotated[str, Path(pattern=r"^(S19|C19)-[0-9]{4}-[0-9]{6}$")], ctx: OwnerAdmin, runtime: RuntimeDep) -> InvoiceDetailOut:
    return _service(runtime).invoice(ctx.principal.token, ctx.tenant.id, number)


@admin_router.post("/businesses/{tenant_id}/topups/{order_id}/refund", response_model=RefundOut)
def refund_topup(tenant_id: uuid.UUID, order_id: OrderId, body: RefundIn, principal: PrincipalDep, runtime: RuntimeDep) -> RefundOut:
    """Owner and finance staff only. Refunds the UNUSED part of one paid top-up (the unused balance plus its share of the GST) to the customer's payment method, takes it out of the balance and issues a credit note.
    Needs a reason in words, a fresh authenticator code (403 `second_confirm_required`) and an idempotency key. Audited. 409 `refund_nothing_unused` / `refund_already_done`; 502 `refund_declined` (nothing changed) or `refund_unconfirmed` (do NOT retry: check with Razorpay)."""
    if runtime.admin is None:
        raise not_found()
    service = _service(runtime)
    try:
        return _guard(lambda: service.refund(principal.token, tenant_id, order_id, body))
    except NothingUnusedError:
        raise ApiError(409, "refund_nothing_unused", "Nothing is left to refund: the balance from that top-up was used.") from None
    except AlreadyRefundedError:
        raise ApiError(409, "refund_already_done", "That top-up already has a refund.") from None
    except NotAPaidTopupError:
        raise ApiError(404, "refund_not_a_topup", "That is not a paid top-up of this business.") from None
    except RefundDeclinedError:
        raise ApiError(502, "refund_declined", "The payment provider did not refund. Nothing changed: the balance is back.") from None
    except RefundUnconfirmedError:
        raise ApiError(502, "refund_unconfirmed", "The refund was asked for but not confirmed. Do not repeat it: check the payment at Razorpay first. The unused balance stays taken out until you do.") from None
    except NotSupportedError:
        raise _unavailable() from None
