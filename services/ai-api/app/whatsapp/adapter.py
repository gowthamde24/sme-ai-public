"""The WhatsApp Cloud API channel adapter (job BR, ADR 0076), behind the outbox's ChannelAdapter port.

What it does with one claimed message (the database has already decided that it may go: policy, blocks, quiet hours, kill switches):
  * no active number for the business, or no token for it           -> failed `not_configured`
  * the customer's 24-hour window is OPEN                           -> photos first (each an `image` message from its signed URL; the text is the first photo's caption when it fits 1,024
                                                                       characters), else one `text` message
  * the window is CLOSED (Meta allows only an approved template)    -> the approved template the database named (the message text is its one variable); no template -> failed
                                                                       `template_required`; a message with photos -> failed `window_closed` (photos cannot go in a template)
  * Meta refuses: 131047 (outside the window) -> `window_closed`; 131026 (cannot be delivered to that number) -> `recipient_unreachable`; 190 / 401 (token) -> `not_configured`;
                  429, 5xx, 130429 / 131056 / 80007 (rate / pair rate / throughput) or the network -> transient (offered again, up to MAX_SEND_ATTEMPTS); any other 4xx -> `rejected`

IDEMPOTENCY. Meta documents no idempotency key for sends. The message id travels as `biz_opaque_callback_data` (and "<id>:<n>" for a photo); the delivery webhook returns it, and the database then
records a message whose own answer was lost as SENT with the WhatsApp id (public.wa_ingest_status), so its lapsed claim is not sent twice. Between the send and that webhook (normally seconds) a
crash can still repeat a message; this is the residual risk ADR 0076 states.

The phone number, the text and the token are never logged."""

from __future__ import annotations

import logging
import re
from typing import Any

from app.outbox.adapter import OutgoingMessage, SendResult
from app.whatsapp.graph import GraphClient, GraphResult
from app.whatsapp.tokens import TokenResolver

logger = logging.getLogger("app.whatsapp.adapter")

CAPTION_MAX = 1024  # Meta: image caption
TEMPLATE_PARAM_MAX = 1000
_SPACES = re.compile(r"\s+")
_RATE_CODES = {130429, 131056, 80007, 131048}
_UNREACHABLE_CODES = {131026}
_TOKEN_CODES = {190, 10}


def template_param(text: str) -> str | None:
    """The one variable of a template: Meta does not accept new lines, tabs or runs of spaces in a template parameter. None when the text does not fit."""
    one = _SPACES.sub(" ", text).strip()
    return one if one and len(one) <= TEMPLATE_PARAM_MAX else None


def text_payload(to: str, body: str, callback: str) -> dict[str, Any]:
    return {"messaging_product": "whatsapp", "recipient_type": "individual", "to": to, "type": "text", "text": {"preview_url": False, "body": body}, "biz_opaque_callback_data": callback}


def image_payload(to: str, link: str, caption: str | None, callback: str) -> dict[str, Any]:
    image: dict[str, Any] = {"link": link}
    if caption:
        image["caption"] = caption
    return {"messaging_product": "whatsapp", "recipient_type": "individual", "to": to, "type": "image", "image": image, "biz_opaque_callback_data": callback}


def template_payload(to: str, name: str, language: str, variable: str, callback: str) -> dict[str, Any]:
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "template",
        "template": {"name": name, "language": {"code": language}, "components": [{"type": "body", "parameters": [{"type": "text", "text": variable}]}]},
        "biz_opaque_callback_data": callback,
    }


def failure_of(result: GraphResult) -> SendResult:
    """Meta's refusal as the outbox's closed failure code, and whether it is worth another try."""
    code = result.error_code
    if code == 131047:
        return SendResult(False, None, "window_closed")
    if code in _UNREACHABLE_CODES:
        return SendResult(False, None, "recipient_unreachable")
    if code in _TOKEN_CODES or result.status in (401, 403):
        return SendResult(False, None, "not_configured")
    if code in _RATE_CODES or result.status == 429:
        return SendResult(False, None, "rate_limited", retry=True)
    if result.transient or result.status == 0:
        return SendResult(False, None, "timeout" if result.status == 0 else "adapter_error", retry=True)
    return SendResult(False, None, "rejected")


class WhatsAppCloudAdapter:
    name = "whatsapp"

    def __init__(self, graph: GraphClient, tokens: TokenResolver) -> None:
        self._graph = graph
        self._tokens = tokens

    def send(self, message: OutgoingMessage) -> SendResult:
        ctx = message.wa
        if ctx is None:
            return SendResult(False, None, "not_configured")
        token = self._tokens.get(ctx.token_ref)
        if token is None:
            logger.error("whatsapp: no token for a business's token reference")
            return SendResult(False, None, "not_configured")
        to = "+" + "".join(ch for ch in message.to_phone if ch.isdigit())
        callback = str(message.message_id)
        if ctx.window_open:
            return self._within_window(message, ctx.phone_number_id, token, to, callback)
        if message.media:
            return SendResult(False, None, "window_closed")
        if ctx.template is None:
            return SendResult(False, None, "template_required")
        variable = template_param(message.body)
        if variable is None:
            return SendResult(False, None, "rejected")
        result = self._graph.post_message(ctx.phone_number_id, token, template_payload(to, ctx.template.name, ctx.template.language, variable, callback))
        return SendResult(True, result.wamid) if result.ok and result.wamid else failure_of(result)

    def _within_window(self, message: OutgoingMessage, phone_number_id: str, token: str, to: str, callback: str) -> SendResult:
        first: str | None = None
        text_sent = False
        for position, ref in enumerate(message.media, start=1):
            if ref.url is None:
                return SendResult(False, None, "adapter_error", retry=True)
            caption = message.body if position == 1 and len(message.body) <= CAPTION_MAX else None
            result = self._graph.post_message(phone_number_id, token, image_payload(to, ref.url, caption, message.media_key(position)))
            if not result.ok or not result.wamid:
                return failure_of(result)
            first = first or result.wamid
            text_sent = text_sent or caption is not None
        if not text_sent:
            result = self._graph.post_message(phone_number_id, token, text_payload(to, message.body, callback))
            if not result.ok or not result.wamid:
                return failure_of(result)
            first = first or result.wamid
        return SendResult(True, first)
