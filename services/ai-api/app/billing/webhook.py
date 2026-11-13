"""The billing provider's webhook (C12): POST /v1/webhooks/razorpay-billing. Like every webhook route it is believed through the provider's SIGNATURE over the raw body and nothing else (a wrong or missing one is a
plain 401 and nothing is read from the body). A believed event is applied by the registered worker account; the database applies each event id once, so a repeated delivery changes nothing. The answer is 200
for anything understood, ignored or repeated, and 503 only when OUR side failed (Razorpay then retries). 404 unless the billing provider is Razorpay (the fake one receives no webhooks).
NOTE: no `from __future__ import annotations` (request objects are attached at registration time)."""

import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.billing.errors import NotSupportedError
from app.billing.razorpay import WebhookRejected
from app.connectors.webhooks import _body, _connectors, _headers, _token
from app.crm.repository import NotFoundError
from app.errors import ApiError, not_found
from app.scheduler.session import SignInError
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.billing.webhook")
router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])


def _webhook_token(runtime: Any) -> str:
    """A token of the billing webhook's dedicated account. Without that account the webhook refuses: it never falls back to the scheduler's account (which can no longer settle orders)."""
    session = getattr(runtime, "billing_webhook", None)
    if session is None:
        logger.error("billing webhook: the dedicated account is not configured")
        raise ApiError(503, "webhooks_unavailable", "Not available right now.")
    try:
        return str(session.token())
    except SignInError:
        logger.error("billing webhook: the dedicated account could not sign in")
        raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None


@router.post("/razorpay-billing")
async def razorpay_billing(request: Request) -> JSONResponse:
    runtime = getattr(request.app.state, "runtime", None)
    billing = getattr(runtime, "billing", None)
    if billing is None or billing.provider.name != "razorpay":
        raise not_found()
    connectors = _connectors(request)
    raw = await _body(request)
    try:
        events = billing.provider.verify_webhook(await _headers(request), raw)
    except WebhookRejected:
        logger.warning("billing webhook: signature refused")
        raise ApiError(401, "unauthorized", "Not authorised.") from None
    except NotSupportedError:
        raise not_found() from None
    if not events:
        return JSONResponse({"ok": True})   # signed, and not about one of our subscriptions
    pricing = getattr(runtime, "pricing", None)
    if pricing is not None:   # billing v2 (the final pricing): renewals, halts, cancels and paid orders go to the pricing functions, once per event / payment, as the billing webhook's OWN account
        try:
            pricing.apply_events(_webhook_token(runtime), events)
        except RepositoryError:
            raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None
        return JSONResponse({"ok": True})
    token = _token(connectors)
    for event in events:
        if event.kind == "order_paid":   # only billing v2 knows paid orders
            continue
        try:
            billing.apply(token, event)
        except NotFoundError:
            logger.warning("billing webhook: an event for an unknown subscription was skipped (%s)", event.kind)
        except RepositoryError:
            raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None
    return JSONResponse({"ok": True})
