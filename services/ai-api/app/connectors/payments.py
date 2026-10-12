"""UPI payment links (job BZ, ADR 0080): Razorpay and Cashfree behind one interface, with a fake. Official APIs only, written from the providers' documentation read on 2026-10-12 (sources in the ADR).

What is sent: the amount (paise; the order's, chosen by a person, never by a model), our reference, a short description, the customer's name and number (the provider needs them to send a reminder; both
are optional with Razorpay), the expiry. What is kept of the answer: the provider's link id and the link address. What is read from a WEBHOOK: the status, the amount paid, the provider's payment reference.
Never stored, never asked for: a card number, a UPI address, a bank detail. A webhook is believed only if its signature checks (the raw body, the shared secret, constant-time compare).

Razorpay   POST https://api.razorpay.com/v1/payment_links/ (basic auth key id : key secret), upi_link true (INR only; not available in test mode); webhook header X-Razorpay-Signature = hex HMAC-SHA256(raw body,
           webhook secret); events payment_link.paid | partially_paid | cancelled | expired with payload.payment_link.entity {id, reference_id, amount, amount_paid, status} and payload.payment.entity {id, amount}.
Cashfree   POST {sandbox.cashfree.com|api.cashfree.com}/pg/links with x-client-id, x-client-secret, x-api-version, optional x-idempotency-key; webhook headers x-webhook-timestamp and x-webhook-signature =
           base64 HMAC-SHA256(timestamp + raw body, client secret); type PAYMENT_LINK_EVENT with data {link_id, cf_link_id, link_status, link_amount, link_amount_paid, order{transaction_id, transaction_status}}."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Protocol

import httpx

from app.connectors.errors import ProviderError, WebhookRejected

logger = logging.getLogger("app.connectors.payments")
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
MAX_WEBHOOK_BYTES = 64 * 1024


@dataclass(frozen=True)
class LinkRequest:
    reference: str  # ours: pl_ and 32 hex digits
    amount_paise: int
    description: str
    expires_at: datetime
    customer_name: str | None = None
    customer_phone: str | None = None  # +91 and ten digits


@dataclass(frozen=True)
class LinkResult:
    provider_link_id: str
    url: str


@dataclass(frozen=True)
class PaymentEvent:
    event_id: str  # a digest of the raw body: a retry carries the same body
    provider_link_id: str
    reference: str | None
    status: str  # paid | partially_paid | expired | cancelled
    amount_paise: int | None
    payment_ref: str | None


class PaymentProvider(Protocol):
    name: str

    def create_link(self, request: LinkRequest, idempotency_key: str) -> LinkResult: ...
    def verify_webhook(self, headers: Mapping[str, str], raw_body: bytes) -> PaymentEvent | None:
        """The event, or None for a well-signed message that is not about a payment link. Raises WebhookRejected when the signature does not check out."""
        ...


def _digest(provider: str, raw: bytes) -> str:
    return f"{provider}:{hashlib.sha256(raw).hexdigest()}"


def _paise(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        amount = (Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    except ArithmeticError:
        return None
    return int(amount) if 0 <= amount <= 1_000_000_000 else None


def _safe(value: object) -> str | None:
    return value if isinstance(value, str) and _SAFE_ID.fullmatch(value) else None


def _post(client: httpx.Client, url: str, **kw: Any) -> Any:
    try:
        response = client.post(url, **kw)
    except httpx.TimeoutException:
        raise ProviderError("timeout") from None
    except httpx.HTTPError as exc:
        logger.warning("payment provider unreachable: %s", exc.__class__.__name__)
        raise ProviderError("unavailable") from None
    if response.status_code in (401, 403):
        raise ProviderError("unauthorized")
    if response.status_code == 429:
        raise ProviderError("rate_limited")
    if response.status_code >= 400:
        logger.warning("payment provider refused: http=%s", response.status_code)
        raise ProviderError("rejected" if response.status_code < 500 else "unavailable")
    try:
        return response.json()
    except ValueError:
        raise ProviderError("bad_response") from None


class RazorpayPayments:
    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str, *, client: httpx.Client | None = None, base_url: str = "https://api.razorpay.com") -> None:
        self._auth = (key_id, key_secret)
        self._webhook_secret = webhook_secret.encode()
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "RazorpayPayments(<keys hidden>)"

    def create_link(self, request: LinkRequest, idempotency_key: str) -> LinkResult:
        customer: dict[str, str] = {}
        if request.customer_name:
            customer["name"] = request.customer_name[:100]
        if request.customer_phone:
            customer["contact"] = request.customer_phone
        body: dict[str, Any] = {
            "upi_link": True,
            "amount": request.amount_paise,
            "currency": "INR",
            "description": request.description[:2048],
            "reference_id": request.reference,
            "expire_by": int(request.expires_at.timestamp()),
            "notify": {"sms": False, "email": False},
            "reminder_enable": False,
        }
        if customer:
            body["customer"] = customer
        answer = _post(self._client, f"{self._base}/v1/payment_links/", json=body, auth=self._auth)
        link_id, url = (_safe(answer.get("id")), answer.get("short_url")) if isinstance(answer, dict) else (None, None)
        if link_id is None or not isinstance(url, str) or not url.startswith("https://") or len(url) > 500:
            raise ProviderError("bad_response")
        return LinkResult(link_id, url)

    def verify_webhook(self, headers: Mapping[str, str], raw_body: bytes) -> PaymentEvent | None:
        given = headers.get("x-razorpay-signature", "")
        expected = hmac.new(self._webhook_secret, raw_body, hashlib.sha256).hexdigest()
        if not given or not hmac.compare_digest(given.encode(), expected.encode()):
            raise WebhookRejected
        try:
            doc = json.loads(raw_body)
            event = doc["event"]
            link = doc["payload"]["payment_link"]["entity"]
        except (ValueError, KeyError, TypeError):
            return None
        status = {"payment_link.paid": "paid", "payment_link.partially_paid": "partially_paid", "payment_link.expired": "expired", "payment_link.cancelled": "cancelled"}.get(event)
        link_id = _safe(link.get("id")) if isinstance(link, dict) else None
        if status is None or link_id is None:
            return None
        payment = doc.get("payload", {}).get("payment", {}).get("entity", {}) if isinstance(doc.get("payload"), dict) else {}
        paid = link.get("amount_paid") if status in ("paid", "partially_paid") else None
        return PaymentEvent(
            _digest(self.name, raw_body),
            link_id,
            _safe(link.get("reference_id")),
            status,
            paid if isinstance(paid, int) and not isinstance(paid, bool) and paid >= 0 else None,
            _safe(payment.get("id")) if isinstance(payment, dict) else None,
        )


class CashfreePayments:
    name = "cashfree"
    API_VERSION = "2025-01-01"

    def __init__(
        self, client_id: str, client_secret: str, *, production: bool = False, notify_url: str | None = None, client: httpx.Client | None = None, base_url: str | None = None
    ) -> None:
        self._id, self._secret = client_id, client_secret
        self._base = (base_url or ("https://api.cashfree.com" if production else "https://sandbox.cashfree.com")).rstrip("/")
        self._notify_url = notify_url
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "CashfreePayments(<keys hidden>)"

    def create_link(self, request: LinkRequest, idempotency_key: str) -> LinkResult:
        if not request.customer_phone:
            raise ProviderError("customer_phone_needed")  # Cashfree requires the customer's phone
        details = {"customer_phone": request.customer_phone[-10:], **({"customer_name": request.customer_name[:100]} if request.customer_name else {})}
        body: dict[str, Any] = {
            "link_id": request.reference,
            "link_amount": float(Decimal(request.amount_paise) / 100),
            "link_currency": "INR",
            "link_purpose": request.description[:500],
            "customer_details": details,
            "link_expiry_time": request.expires_at.isoformat(),
            "link_notify": {"send_sms": False, "send_email": False},
        }
        if self._notify_url:
            body["link_meta"] = {"notify_url": self._notify_url}
        headers = {"x-client-id": self._id, "x-client-secret": self._secret, "x-api-version": self.API_VERSION, "x-idempotency-key": idempotency_key}
        answer = _post(self._client, f"{self._base}/pg/links", json=body, headers=headers)
        link_id, url = (_safe(answer.get("cf_link_id") and str(answer.get("cf_link_id"))), answer.get("link_url")) if isinstance(answer, dict) else (None, None)
        if link_id is None or not isinstance(url, str) or not url.startswith("https://") or len(url) > 500:
            raise ProviderError("bad_response")
        return LinkResult(link_id, url)

    def verify_webhook(self, headers: Mapping[str, str], raw_body: bytes) -> PaymentEvent | None:
        timestamp, given = headers.get("x-webhook-timestamp", ""), headers.get("x-webhook-signature", "")
        if not timestamp or not given:
            raise WebhookRejected
        # the documentation shows two spellings of the signed text (timestamp then body, with and without a dot between); either needs the secret
        ok = False
        for joiner in (b"", b"."):
            mac = hmac.new(self._secret.encode(), timestamp.encode() + joiner + raw_body, hashlib.sha256).digest()
            ok = hmac.compare_digest(base64.b64encode(mac), given.encode()) or ok
        if not ok:
            raise WebhookRejected
        try:
            doc = json.loads(raw_body)
            data = doc["data"]
            kind = doc["type"]
        except (ValueError, KeyError, TypeError):
            return None
        if kind != "PAYMENT_LINK_EVENT" or not isinstance(data, dict):
            return None
        status = {"PAID": "paid", "PARTIALLY_PAID": "partially_paid", "EXPIRED": "expired", "CANCELLED": "cancelled"}.get(str(data.get("link_status")))
        cf_id = data.get("cf_link_id")
        link_id = _safe(str(cf_id)) if cf_id is not None else None
        if status is None or link_id is None:
            return None
        order = data.get("order")
        ref = _safe(order.get("transaction_id") and str(order.get("transaction_id"))) if isinstance(order, dict) else None
        return PaymentEvent(_digest(self.name, raw_body), link_id, _safe(data.get("link_id")), status, _paise(data.get("link_amount_paid")) if status in ("paid", "partially_paid") else None, ref)


FAKE_SECRET = "fake-payments-webhook-secret-not-a-real-secret"  # noqa: S105 - published and worthless: development and tests only


class FakePayments:
    """No network, no key: links on a reserved .test address, and webhooks signed the Razorpay way with a published, worthless secret (development and tests only)."""

    name = "fake"

    def __init__(self) -> None:
        self.created: list[LinkRequest] = []

    def create_link(self, request: LinkRequest, idempotency_key: str) -> LinkResult:
        self.created.append(request)
        return LinkResult(f"fake_{request.reference[3:15]}", f"https://pay.example-upi.test/{request.reference}")

    def verify_webhook(self, headers: Mapping[str, str], raw_body: bytes) -> PaymentEvent | None:
        return RazorpayPayments("x", "x", FAKE_SECRET).verify_webhook(headers, raw_body)

    @staticmethod
    def signed(body: dict[str, Any]) -> tuple[bytes, dict[str, str]]:
        raw = json.dumps(body, separators=(",", ":")).encode()
        return raw, {"x-razorpay-signature": hmac.new(FAKE_SECRET.encode(), raw, hashlib.sha256).hexdigest()}
