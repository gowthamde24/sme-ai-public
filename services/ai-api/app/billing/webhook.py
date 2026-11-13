"""The billing provider's webhook (C12): POST /v1/webhooks/razorpay-billing. Like every webhook route it is believed through the provider's SIGNATURE over the raw body and nothing else (a wrong or missing one is a
plain 401 and nothing is read from the body). A believed event is applied by the registered worker account; the database applies each event id once, so a repeated delivery changes nothing. The answer is 200
for anything understood, ignored or repeated, and 503 only when OUR side failed (Razorpay then retries). 404 unless the billing provider is Razorpay (the fake one receives no webhooks).
NOTE: no `from __future__ import annotations` (request objects are attached at registration time)."""

import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.billing.errors import NotSupportedError
from app.billing.razorpay import WebhookRejected
from app.connectors.webhooks import _body, _connectors, _headers, _token
from app.crm.repository import NotFoundError
from app.errors import ApiError, not_found
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.billing.webhook")
router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])


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
    token = _token(connectors)
    for event in events:
        try:
            billing.apply(token, event)
        except NotFoundError:
            logger.warning("billing webhook: an event for an unknown subscription was skipped (%s)", event.kind)
        except RepositoryError:
            raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None
    return JSONResponse({"ok": True})
