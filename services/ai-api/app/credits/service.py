# ruff: noqa: E501
"""The credits top-up (docs/contracts/credits-topup.md): amounts and options, the checkout-ready order, the signature-checked confirmation, a failed or closed payment, the statement, one GST invoice in full, and the
staff refund of what is unused. The rules (amounts, GST, once-per-payment, invoice numbers, refund maths) live in the database (migrations 20261231992200 and 20261231992210); here they become words and numbers."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal, Protocol

from app.admin.service import ERRORS as ADMIN_ERRORS
from app.billing.errors import NotSupportedError
from app.billing.provider import BillingProvider
from app.credits.errors import AlreadyRefundedError, NotAPaidTopupError, NothingUnusedError
from app.credits.models import (
    MAX_RUPEES,
    MIN_RUPEES,
    PRESET_RUPEES,
    AmountOut,
    InvoiceDetailOut,
    RefundIn,
    RefundOut,
    StatementOut,
    StatementRowOut,
    TopupConfirmOut,
    TopupFailedOut,
    TopupOptionsOut,
    TopupOrderOut,
    TopupRowOut,
    TopupsOut,
)
from app.pricing.inr import inr
from app.pricing.models import OrderIn
from app.pricing.service import OrderRefusedError, PaymentNotVerifiedError, PricingService
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.credits")

_FAILURE_TEXT = {
    "payment_failed": "The payment did not go through. If money left your account, your bank returns it in 5 to 7 working days.",
    "bank_declined": "Your bank declined the payment. Try another UPI app, card or bank.",
    "payment_cancelled": "The payment was cancelled.",
    "dismissed": "The payment window was closed before paying.",
    "amount_mismatch": "The amount paid did not match this order, so nothing was added. Stack19 support will look at it: write to us with this order.",
}
_FAILED_REASON = {"failed": "payment_failed", "dismissed": "dismissed", "cancelled": "payment_cancelled"}
Mode = Literal["test", "live", "fake"]


class TopupAmountInvalidError(Exception):
    """The amount is not a whole number of rupees between the minimum and the maximum."""


class TopupNotVerifiedError(Exception):
    """The provider's signature on the payment did not check (or the payment belongs to another order): nothing was added."""


class TopupOrderUnknownError(Exception):
    """No top-up order with that id in this business."""


class RefundUnconfirmedError(Exception):
    """The provider was asked for the refund but the answer is unknown: the refund stays `pending` (the unused balance is already taken out) for a person to settle with the provider."""


class RefundDeclinedError(Exception):
    """The provider refused the refund: the unused balance was given back, nothing was refunded."""


class CreditsRepository(Protocol):
    def topup_orders(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def order_failed(self, token: str, order_id: str, code: str) -> dict[str, Any]: ...
    def statement(self, token: str, tenant_id: uuid.UUID, date_from: str | None, date_to: str | None, limit: int, before: str | None) -> dict[str, Any]: ...
    def invoice_detail(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]: ...
    def refund_begin(self, token: str, tenant_id: uuid.UUID, order_id: str, reason_code: str, reason_text: str, key: str) -> dict[str, Any]: ...
    def refund_finish(self, token: str, refund_id: str, ok: bool, provider_ref: str | None) -> dict[str, Any]: ...


class PostgrestCreditsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {**ADMIN_ERRORS, "SM936": NothingUnusedError, "SM937": AlreadyRefundedError, "SM938": NotAPaidTopupError, "22023": OrderRefusedError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def topup_orders(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return list(self._rpc.array(token, "pricing_topup_orders", {"p_tenant_id": str(tenant_id), "p_limit": limit}))

    def order_failed(self, token: str, order_id: str, code: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_order_failed", {"p_order_id": order_id, "p_code": code})

    def statement(self, token: str, tenant_id: uuid.UUID, date_from: str | None, date_to: str | None, limit: int, before: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_statement", {"p_tenant_id": str(tenant_id), "p_from": date_from, "p_to": date_to, "p_limit": limit, "p_before": before})

    def invoice_detail(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._rpc.object(token, "pricing_invoice_detail", {"p_tenant_id": str(tenant_id), "p_number": number})

    def refund_begin(self, token: str, tenant_id: uuid.UUID, order_id: str, reason_code: str, reason_text: str, key: str) -> dict[str, Any]:
        return self._rpc.object(token, "admin_topup_refund_begin", {"p_tenant_id": str(tenant_id), "p_order_id": order_id, "p_reason_code": reason_code, "p_reason_text": reason_text, "p_key": key})

    def refund_finish(self, token: str, refund_id: str, ok: bool, provider_ref: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "admin_topup_refund_finish", {"p_refund_id": refund_id, "p_ok": ok, "p_provider_ref": provider_ref})


def gst_of(paise: int, gst_bps: int = 1800) -> int:
    """GST added on top, rounded half up to the paisa: the same sum as the database's pricing.gst_of."""
    return (paise * gst_bps + 5000) // 10000


def amount_out(rupees: int, gst_bps: int = 1800) -> AmountOut:
    added = rupees * 100
    gst = gst_of(added, gst_bps)
    return AmountOut(added_paise=added, gst_paise=gst, total_paise=added + gst, added_text=inr(added), gst_text=inr(gst), total_text=inr(added + gst))


def _kind_text(kind: str) -> str:
    return {"topup": "Call balance top-up", "credit_note": "Credit note for a refund", "payg_fee": "Pay as you go monthly fee", "subscription": "Plan subscription"}.get(kind, "Stack19")


def _mode(provider: BillingProvider | None) -> Mode:
    mode = provider.mode if provider is not None else "fake"
    return "test" if mode == "test" else "live" if mode == "live" else "fake"


class CreditsService:
    def __init__(self, repository: CreditsRepository, pricing: PricingService) -> None:
        self._repo = repository
        self._pricing = pricing

    def _provider(self) -> BillingProvider:
        provider = self._pricing.provider
        if provider is None:
            raise NotSupportedError("no payment provider")
        return provider

    # ------------------------------------------------------------------------------------------------ what the customer may choose
    def options(self, token: str) -> TopupOptionsOut:
        cat = self._pricing.catalogue(token)
        bps = round(cat.gst_percent * 100)
        provider = self._pricing.provider
        return TopupOptionsOut(gst_percent=cat.gst_percent, presets=[amount_out(r, bps) for r in PRESET_RUPEES], custom_min_rupees=MIN_RUPEES, custom_max_rupees=MAX_RUPEES, mode=_mode(provider), checkout_ready=provider is not None)

    # ------------------------------------------------------------------------------------------------ step 1: the order
    def create_topup(self, token: str, tenant_id: uuid.UUID, rupees: int) -> TopupOrderOut:
        if not MIN_RUPEES <= rupees <= MAX_RUPEES:
            raise TopupAmountInvalidError(str(rupees))
        provider = self._provider()
        try:
            order = self._pricing.create_order(token, tenant_id, OrderIn(purpose="topup", amount_paise=rupees * 100))
        except OrderRefusedError:
            raise TopupAmountInvalidError(str(rupees)) from None
        added = rupees * 100
        gst = order.total_paise - added
        return TopupOrderOut(
            provider=order.provider, mode=_mode(provider), order_id=order.order_id, key_id=order.key_id, currency="INR", amount_paise=order.total_paise, added_paise=added, gst_paise=gst,
            added_text=inr(added), gst_text=inr(gst), total_text=inr(order.total_paise), name="Stack19", description=f"Call balance {inr(added)} + GST",
        )

    # ------------------------------------------------------------------------------------------------ step 2: the checkout's answer
    @staticmethod
    def _row(doc: dict[str, Any]) -> TopupRowOut:
        code = doc.get("failure_code")
        return TopupRowOut(
            order_id=doc["order_id"], state=doc["state"], added_paise=int(doc["credits_paise"]), gst_paise=int(doc["gst_paise"]), total_paise=int(doc["total_paise"]), added_text=inr(int(doc["credits_paise"])),
            total_text=inr(int(doc["total_paise"])), failure_code=code, failure_text=_FAILURE_TEXT.get(str(code), "The payment did not go through.") if code else None, created_at=doc["created_at"], paid_at=doc.get("paid_at"),
            invoice_number=doc.get("invoice_number"), refunded=bool(doc.get("refunded")),
        )

    def orders(self, token: str, tenant_id: uuid.UUID, limit: int = 20) -> TopupsOut:
        return TopupsOut(items=[self._row(d) for d in self._repo.topup_orders(token, tenant_id, limit)])

    def _find(self, token: str, tenant_id: uuid.UUID, order_id: str) -> dict[str, Any] | None:
        return next((d for d in self._repo.topup_orders(token, tenant_id, 100) if d["order_id"] == order_id), None)

    def confirm_topup(self, token: str, tenant_id: uuid.UUID, order_id: str, payment_id: str, signature: str) -> TopupConfirmOut:
        """The checkout returned its payment id and signature. Wrong signature: nothing happens. Right signature: the stored order is settled once, whoever gets there first (this call, the webhook); a repeat answers the same."""
        known = self._find(token, tenant_id, order_id)
        if known is None:
            raise TopupOrderUnknownError(order_id)
        try:
            done = self._pricing.settle_checked(token, tenant_id, order_id, payment_id, signature)
        except (PaymentNotVerifiedError, OrderRefusedError):   # a wrong signature, or a payment that already settled a different order
            raise TopupNotVerifiedError(order_id) from None
        after = self._find(token, tenant_id, order_id) or known
        return TopupConfirmOut(state="paid", replayed=bool(done.get("replayed")), added_text=inr(int(after["credits_paise"])), balance=self._pricing.balance(token, tenant_id), invoice_number=after.get("invoice_number"))

    def failed(self, token: str, order_id: str, reason: str) -> TopupFailedOut:
        """The checkout reported a failure or was closed. Recorded on the order so the customer (and support) can see it; a later successful payment of the same order still settles."""
        got = self._repo.order_failed(token, order_id, _FAILED_REASON.get(reason, "payment_failed"))
        return TopupFailedOut(recorded=bool(got.get("recorded")))

    # ------------------------------------------------------------------------------------------------ reads
    def statement(self, token: str, tenant_id: uuid.UUID, date_from: str | None, date_to: str | None, limit: int, before: str | None) -> StatementOut:
        d = self._repo.statement(token, tenant_id, date_from, date_to, limit, before)
        rows = [
            StatementRowOut(at=i["at"], kind=i["kind"], label=i["label"], amount_paise=int(i["amount_paise"]), amount_text=inr(int(i["amount_paise"])), balance_after_paise=int(i["balance_after_paise"]),
                            balance_after_text=inr(int(i["balance_after_paise"])), ref=str(i["ref"]), invoice_number=i.get("invoice_number"))
            for i in d["items"]
        ]
        return StatementOut(
            items=rows, has_more=bool(d["has_more"]), next_before=d.get("next_before"), opening_paise=int(d["opening_paise"]), closing_paise=int(d["closing_paise"]), opening_text=inr(int(d["opening_paise"])),
            closing_text=inr(int(d["closing_paise"])), balance_paise=int(d["balance_paise"]), balance_text=inr(int(d["balance_paise"])),
        )

    def invoice(self, token: str, tenant_id: uuid.UUID, number: str) -> InvoiceDetailOut:
        d = self._repo.invoice_detail(token, tenant_id, number)
        return InvoiceDetailOut(
            number=d["number"], kind=d["kind"], issued_at=d["issued_at"], description=_kind_text(d["kind"]), subtotal_paise=int(d["subtotal_paise"]), gst_paise=int(d["gst_paise"]), total_paise=int(d["total_paise"]),
            subtotal_text=inr(int(d["subtotal_paise"])), gst_text=inr(int(d["gst_paise"])), total_text=inr(int(d["total_paise"])), gst_percent=float(d["gst_percent"]), tax_split=d.get("tax_split"),
            cgst_paise=int(d["cgst_paise"]), sgst_paise=int(d["sgst_paise"]), igst_paise=int(d["igst_paise"]), against_number=d.get("against_number"), buyer_name=d.get("buyer_name"), buyer_gstin=d.get("buyer_gstin"),
            buyer_state_code=d.get("buyer_state_code"), seller_name=d.get("seller_name"), seller_gstin=d.get("seller_gstin"), seller_address=d.get("seller_address"), seller_sac=d.get("seller_sac"),
            seller_details_missing=not (d.get("seller_name") and d.get("seller_gstin")),
        )

    # ------------------------------------------------------------------------------------------------ the refund (staff)
    def refund(self, token: str, tenant_id: uuid.UUID, order_id: str, body: RefundIn) -> RefundOut:
        """Step 1 takes the unused balance out and records a pending refund; then the provider is asked; step 2 records the answer. The unused balance is never given back while a refund may be on its way, and the
        provider is never asked twice for one refund (a retry that finds the refund still pending stops and tells a person)."""
        begun = self._repo.refund_begin(token, tenant_id, order_id, body.reason_code, body.reason_text, body.idempotency_key)
        refund_id = str(begun["refund_id"])
        status = begun.get("status")
        if status == "done":
            done = self._repo.refund_finish(token, refund_id, True, "already_done")   # answers itself: the refund is finished, nothing is written
            return self._refund_out(begun, done, replayed=True)
        if status == "failed":
            raise RefundDeclinedError(refund_id)
        if begun.get("replayed"):   # pending from an earlier try: we do not know whether the provider paid it out
            raise RefundUnconfirmedError(refund_id)
        try:
            provider_ref = self._provider().refund_payment(str(begun["payment_ref"]), int(begun["refund_paise"]), body.idempotency_key)
        except NotSupportedError as exc:
            if str(exc) in {"unreachable", "not json"} or str(exc).startswith("status 5"):   # no clear answer: it may have been done
                raise RefundUnconfirmedError(refund_id) from None
            self._repo.refund_finish(token, refund_id, False, None)
            raise RefundDeclinedError(refund_id) from None
        except RepositoryError:   # a 400 from the provider: refused, nothing refunded
            self._repo.refund_finish(token, refund_id, False, None)
            raise RefundDeclinedError(refund_id) from None
        done = self._repo.refund_finish(token, refund_id, True, provider_ref)
        return self._refund_out(begun, done, replayed=False)

    @staticmethod
    def _refund_out(begun: dict[str, Any], done: dict[str, Any], *, replayed: bool) -> RefundOut:
        return RefundOut(
            refund_id=str(begun["refund_id"]), status="done", refund_paise=int(begun["refund_paise"]), refund_text=inr(int(begun["refund_paise"])), unused_paise=int(begun["credits_reversed_paise"]),
            gst_paise=int(begun["gst_refund_paise"]), credit_note_number=done.get("credit_note_number"), replayed=replayed,
        )
