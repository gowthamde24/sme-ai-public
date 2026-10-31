"""Lead e-mails received by Resend (owner, 30 Oct 2026: `leads.stack19.com` receives through Resend, so stack19.com's own mail and Zoho are never touched).

Resend calls our webhook with an `email.received` event that carries only metadata (sender, recipients, subject, message id and the id of the stored mail). The mail itself is fetched here from Resend's
API with the LEADS key (`LEAD_RESEND_API_KEY`, secret `sme-resend-leads-api-key`, which is NOT the key the app's own e-mails are sent with) and then goes to the same reader as every other forwarded mail.

The webhook is signed the Svix way (Resend uses Svix): `svix-id`, `svix-timestamp`, `svix-signature` (`v1,<base64>`, space-separated when there are several); the signed text is `<id>.<timestamp>.<raw body>`,
HMAC-SHA256 under the base64-decoded part of `whsec_...` after the prefix, base64 out; five minutes of clock either way. Everything in the mail is untrusted data."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from email.utils import parseaddr
from typing import Any, Protocol

import httpx

from app.lead_sources import mime

logger = logging.getLogger("app.lead_sources.resend")
logging.getLogger("httpx").setLevel(logging.WARNING)   # its INFO line would carry the address, and the address carries the token
API = "https://api.resend.com"
TOLERANCE_SECONDS = 300
MAX_SIGNATURES = 6
_HEADER_VALUE = re.compile(r"^[\x21-\x7e]{1,300}$")


class ResendError(Exception):
    pass


@dataclass(frozen=True)
class ReceivedMail:
    sender: str
    to: tuple[str, ...]
    subject: str = ""
    text: str = ""
    message_id: str | None = None


class MailFetcher(Protocol):
    def fetch(self, email_id: str) -> ReceivedMail:
        """The stored mail; raises ResendError."""
        ...


def signature_ok(secret: str, svix_id: str | None, timestamp: str | None, header: str | None, raw: bytes, *, now: float | None = None) -> bool:
    """Is this call from Resend (Svix)? Never raises; False on anything out of shape."""
    if not secret or not svix_id or not timestamp or not header or not _HEADER_VALUE.fullmatch(svix_id):
        return False
    try:
        seconds = int(timestamp)
        key = base64.b64decode(secret.removeprefix("whsec_"), validate=True)
    except (ValueError, binascii.Error):
        return False
    if abs((time.time() if now is None else now) - seconds) > TOLERANCE_SECONDS:
        return False
    expected = base64.b64encode(hmac.new(key, f"{svix_id}.{seconds}.".encode() + raw, hashlib.sha256).digest()).decode()
    for part in header.split()[:MAX_SIGNATURES]:
        version, _, value = part.partition(",")
        if version == "v1" and hmac.compare_digest(expected.encode(), value.encode()):
            return True
    return False


def email_id_of(payload: object) -> str | None:
    """The id of the stored mail from an `email.received` event, or None for any other event or shape."""
    if not isinstance(payload, dict) or payload.get("type") != "email.received":
        return None
    data = payload.get("data")
    value = data.get("email_id") if isinstance(data, dict) else None
    try:
        return str(uuid.UUID(value)) if isinstance(value, str) else None   # a UUID only: it is put in a URL
    except ValueError:
        return None


def _addresses(value: object) -> tuple[str, ...]:
    items = value if isinstance(value, list) else [value]
    return tuple(a[:320] for a in (parseaddr(str(v))[1] for v in items[:20] if isinstance(v, str)) if a)


class ResendMailFetcher:
    def __init__(self, api_key: str, *, client: httpx.Client | None = None, base_url: str = API) -> None:
        self._key = api_key
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "ResendMailFetcher(<key hidden>)"

    def fetch(self, email_id: str) -> ReceivedMail:
        try:
            response = self._client.get(f"{self._base}/emails/receiving/{email_id}", headers={"Authorization": f"Bearer {self._key}", "Accept": "application/json"})
            body = response.json()
        except (httpx.HTTPError, ValueError):
            raise ResendError("unreachable") from None
        if response.status_code != 200 or not isinstance(body, dict):
            logger.warning("resend refused a received-mail fetch: http=%s", response.status_code)
            raise ResendError("refused")
        text = str(body["text"]) if isinstance(body.get("text"), str) else ""
        if not text.strip() and isinstance(body.get("html"), str):
            text = mime.html_to_text(str(body["html"])[: mime.MAX_TEXT * 2])
        sender = _addresses(body.get("from"))
        return ReceivedMail(
            sender=sender[0] if sender else "",
            to=_addresses(body.get("to")) + _addresses(body.get("received_for")),
            subject=" ".join(str(body.get("subject") or "").split())[:500],
            text=text.strip()[:mime.MAX_TEXT],
            message_id=" ".join(str(body.get("message_id") or "").split())[:300] or None,
        )


@dataclass
class FakeMailFetcher:
    """Development and tests: stored mail id -> mail."""

    mails: dict[str, ReceivedMail] = field(default_factory=dict)
    fetched: list[str] = field(default_factory=list)

    def fetch(self, email_id: str) -> ReceivedMail:
        self.fetched.append(email_id)
        if email_id not in self.mails:
            raise ResendError("refused")
        return self.mails[email_id]


@dataclass(frozen=True)
class ResendInbound:
    """What the receiver needs: the signing secret and a way to fetch the mail."""

    webhook_secret: str
    fetcher: Any = None
