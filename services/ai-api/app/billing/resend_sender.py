"""Resend's HTTP API as an e-mail sender (job RESEND, owner approval of 26 Oct 2026: staging first).

From noreply@stack19.com, reply-to support@stack19.com. The key is given to the constructor (it comes from Google Secret Manager through the RESEND_API_KEY environment variable) and is used only as the
Authorization header: it is never logged, never in an error, never in a repr. Nothing about a message is logged on failure except the HTTP status (no address, no text). Tracking (open and click) is off in the
Resend domain settings, and the messages carry no images or tracking links. A retry of the same reminder carries the same Idempotency-Key, so Resend drops the duplicate."""

from __future__ import annotations

import logging

import httpx

from app.billing.mail import Email

logger = logging.getLogger("app.billing.resend")

API_URL = "https://api.resend.com/emails"
FROM_ADDRESS = "Stack19 <noreply@stack19.com>"
REPLY_TO = "support@stack19.com"


class ResendEmailSender:
    name = "resend"

    def __init__(self, api_key: str, *, client: httpx.Client | None = None) -> None:
        self._key = api_key
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "ResendEmailSender(key=<hidden>)"

    def send(self, message: Email) -> bool:
        headers = {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json", "User-Agent": "stack19-api"}
        if message.idempotency_key:
            headers["Idempotency-Key"] = message.idempotency_key[:256]
        payload: dict[str, object] = {"from": FROM_ADDRESS, "to": [message.to], "reply_to": REPLY_TO, "subject": message.subject, "text": message.body}
        if message.html:
            payload["html"] = message.html
        try:
            response = self._client.post(API_URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("e-mail: Resend unreachable (%s)", exc.__class__.__name__)
            return False
        if response.is_success:
            logger.info("e-mail: one message handed to Resend")
            return True
        logger.error("e-mail: Resend refused a message (HTTP %s)", response.status_code)
        return False
