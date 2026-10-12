"""The providers' webhooks (job BZ, ADR 0080): the only routes here that no person signs in to. Each is believed through the provider's own check, nothing else:

  POST /v1/webhooks/razorpay | /cashfree | /fake-payments       the provider's SIGNATURE over the raw body (a wrong or missing one is a plain 401 and nothing is read from the body)
  GET|POST /v1/webhooks/exotel/{token}/missed-call              a long secret in the address (Exotel signs nothing at the Passthru applet)
  POST /v1/webhooks/exotel/{token}/call-status                  the same secret

A believed message is passed to the database by the registered worker account (job AW), whose only power is to call the public.scheduler_* functions; they re-check everything (a message seen before changes
nothing; a link or call the database does not know is ignored). The answer to the provider is 200 for anything that was understood, ignored or repeated, and 503 only when OUR side failed (so that the
provider retries). The body is read up to 64 KB. Nothing from a body, no number and no secret is logged.

NOTE: no `from __future__ import annotations` (request objects are attached at registration time)."""

import hmac
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.connectors import calls as call_module
from app.connectors.errors import ConnectorRefused, WebhookRejected
from app.connectors.payments import MAX_WEBHOOK_BYTES, PaymentProvider
from app.connectors.runtime import Connectors
from app.connectors.texts import MISSED_CALL_REPLY
from app.errors import ApiError, not_found
from app.scheduler.session import PrincipalSession, SignInError
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.connectors.webhooks")
router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])
_NS = uuid.UUID("9b0f3d2e-4a52-4c63-8d3f-2e7f4b1c6a10")
OK = {"ok": True}


def _connectors(request: Request) -> Connectors:
    runtime = getattr(request.app.state, "runtime", None)
    c = getattr(runtime, "connectors", None)
    if c is None:
        raise not_found()
    return c  # type: ignore[no-any-return]


def _token(c: Connectors) -> str:
    receiver: PrincipalSession | None = c.receiver
    if receiver is None:
        raise ApiError(503, "webhooks_unavailable", "Not available right now.")
    try:
        return receiver.token()
    except SignInError:
        raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None


async def _body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_WEBHOOK_BYTES:
        raise ApiError(413, "too_large", "Too large.")
    raw = await request.body()
    if len(raw) > MAX_WEBHOOK_BYTES:
        raise ApiError(413, "too_large", "Too large.")
    return raw


def _payment(c: Connectors, provider: PaymentProvider | None, raw: bytes, headers: dict[str, str]) -> JSONResponse:
    if provider is None:
        raise not_found()
    try:
        event = provider.verify_webhook(headers, raw)
    except WebhookRejected:
        logger.warning("payment webhook: signature refused (%s)", provider.name)
        raise ApiError(401, "unauthorized", "Not authorised.") from None
    if event is None:
        return JSONResponse(OK)  # signed, and not about a payment link
    token = _token(c)
    try:
        c.repo.call(
            token,
            "scheduler_payment_event",
            {
                "p_provider": provider.name,
                "p_event_id": event.event_id,
                "p_provider_link_id": event.provider_link_id,
                "p_reference": event.reference,
                "p_status": event.status,
                "p_amount_paise": event.amount_paise,
                "p_payment_ref": event.payment_ref,
            },
        )
    except ConnectorRefused:
        logger.error("payment webhook: the database refused a signed message")
        return JSONResponse(OK)  # a signed message we cannot use will not become usable by a retry
    except UpstreamError:
        raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None
    return JSONResponse(OK)


async def _headers(request: Request) -> dict[str, str]:
    return {k.lower(): v for k, v in request.headers.items()}


@router.post("/razorpay")
async def razorpay(request: Request) -> JSONResponse:
    c = _connectors(request)
    provider = c.payments if c.payments is not None and c.payments.name == "razorpay" else None
    return _payment(c, provider, await _body(request), await _headers(request))


@router.post("/cashfree")
async def cashfree(request: Request) -> JSONResponse:
    c = _connectors(request)
    provider = c.payments if c.payments is not None and c.payments.name == "cashfree" else None
    return _payment(c, provider, await _body(request), await _headers(request))


@router.post("/fake-payments")
async def fake_payments(request: Request) -> JSONResponse:
    c = _connectors(request)
    provider = c.payments if c.payments is not None and c.payments.name == "fake" else None
    return _payment(c, provider, await _body(request), await _headers(request))


# ------------------------------------------------------------------------------------------------ Exotel
def _secret_ok(c: Connectors, token: str) -> None:
    if c.calls is None or not c.webhook_token or not hmac.compare_digest(token.encode(), c.webhook_token.encode()):
        raise not_found()


async def _params(request: Request) -> dict[str, Any]:
    params: dict[str, Any] = dict(request.query_params)
    if request.method == "POST":
        raw = await _body(request)
        ctype = request.headers.get("content-type", "")
        try:
            if "json" in ctype:
                doc = json.loads(raw or b"{}")
                if isinstance(doc, dict):
                    params.update({k: v for k, v in doc.items() if isinstance(v, (str, int))})
            elif raw:
                params.update(dict(parse_qsl(raw.decode("utf-8", "replace"))))
        except ValueError:
            raise ApiError(400, "bad_request", "Bad request.") from None
    return params


@router.get("/exotel/{token}/missed-call")
@router.post("/exotel/{token}/missed-call")
async def exotel_missed_call(token: str, request: Request) -> JSONResponse:
    c = _connectors(request)
    _secret_ok(c, token)
    parsed = call_module.passthru({k: str(v) for k, v in (await _params(request)).items()})
    if parsed is None or c.tenant_id is None:
        return JSONResponse(OK)
    call_id, caller = parsed
    language = c.reply_language
    try:
        c.repo.call(
            _token(c),
            "scheduler_missed_call",
            {
                "p_tenant_id": str(c.tenant_id),
                "p_provider": c.calls.name if c.calls else "exotel",
                "p_call_id": call_id,
                "p_phone": caller,
                "p_called_at": datetime.now(UTC).isoformat(),
                "p_message_id": str(uuid.uuid5(_NS, f"missed:{call_id}")),
                "p_body": MISSED_CALL_REPLY[language],
                "p_language": language,
            },
        )
    except ConnectorRefused:
        logger.error("missed-call webhook: the database refused a call")
    except UpstreamError:
        raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None
    return JSONResponse(OK)


@router.post("/exotel/{token}/call-status")
async def exotel_call_status(token: str, request: Request) -> JSONResponse:
    c = _connectors(request)
    _secret_ok(c, token)
    parsed = call_module.status_of(await _params(request))
    if parsed is None:
        return JSONResponse(OK)
    sid, status = parsed
    try:
        c.repo.call(_token(c), "scheduler_call_status", {"p_provider": c.calls.name if c.calls else "exotel", "p_provider_call_id": sid, "p_status": status})
    except ConnectorRefused:
        logger.error("call-status webhook: the database refused a message")
    except UpstreamError:
        raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None
    return JSONResponse(OK)
