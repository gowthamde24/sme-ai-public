"""Resend's HTTP API as an e-mail sender (job RESEND, owner approval of 26 Oct 2026: staging first).

From the address in MAIL_FROM (shown as "Stack19 <address>"), reply-to MAIL_REPLY_TO (addresses live in the environment, not in code). The key is given to the constructor (it comes from Google Secret Manager through the RESEND_API_KEY environment variable) and is used only as the
Authorization header: it is never logged, never in an error, never in a repr. Nothing about a message is logged on failure except the HTTP status (no address, no text). Tracking (open and click) is off in the
Resend domain settings, and the messages carry no images or tracking links. A retry of the same reminder carries the same Idempotency-Key, so Resend drops the duplicate."""

from __future__ import annotations

import logging
import re

import httpx

from app.billing.mail import Email

logger = logging.getLogger("app.billing.resend")

API_URL = "https://api.resend.com/emails"
_ADDRESS = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


class ResendEmailSender:
    name = "resend"

    def __init__(self, api_key: str, mail_from: str, reply_to: str | None = None, *, client: httpx.Client | None = None) -> None:
        if not _ADDRESS.match(mail_from) or (reply_to is not None and not _ADDRESS.match(reply_to)):
            raise ValueError("MAIL_FROM and MAIL_REPLY_TO must each be one plain address")
        self._key = api_key
        self._from = f"Stack19 <{mail_from}>"
        self._reply_to = reply_to
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "ResendEmailSender(key=<hidden>)"

    def send(self, message: Email) -> bool:
        headers = {"Authorization": f"Bearer {self._key}", "Content-Type": "application/json", "User-Agent": "stack19-api"}
        if message.idempotency_key:
            headers["Idempotency-Key"] = message.idempotency_key[:256]
        payload: dict[str, object] = {"from": self._from, "to": [message.to], "subject": message.subject, "text": message.body}
        if self._reply_to:
            payload["reply_to"] = self._reply_to
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
