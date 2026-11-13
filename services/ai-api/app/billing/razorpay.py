"""Razorpay Subscriptions for billing, TEST MODE ONLY (C12, owner decision 12 Nov 2026: "Razorpay TEST billing, mocked until the owner stores the TEST keys"). Written from Razorpay's documentation
(Subscriptions API, Checkout signature, Webhooks) and tested against recorded-shape fakes: it has NOT yet run against Razorpay's test servers, because no test key is stored. The first run with the
owner's test keys is the check of this file (docs/plans/razorpay-test-billing.md).

  * Keys: `rzp_test_...` only. A `rzp_live_` key stops the process at start (live billing is OFF everywhere until the owner says so).
  * Checkout: the server creates the subscription (`begin_checkout`, notes carry our tenant id and plan), the browser opens Razorpay's Checkout with its id, and returns payment id, subscription id and
    signature. Our servers never see a card or a UPI detail. `checkout_ref` = "<subscription_id>.<payment_id>.<signature>"; the signature is verified here (HMAC-SHA256 of "<payment_id>|<subscription_id>").
  * Events: POST /v1/webhooks/razorpay-billing, header X-Razorpay-Signature = hex HMAC-SHA256 of the raw body with the WEBHOOK secret; the event id is X-Razorpay-Event-Id (applying one twice changes nothing).
  * Not here yet: one-off charges (top-up packs need an Orders checkout) and moving the first-charge date after the subscription exists (Razorpay fixes `start_at` at creation): both are written down in the plan."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.billing.errors import NotSupportedError, PaymentMethodDeclinedError
from app.billing.provider import (
    ChargeResult,
    CreateSubscription,
    EventKind,
    OneOffCharge,
    ProviderEvent,
    ProviderSubscription,
)

logger = logging.getLogger("app.billing.razorpay")
BASE = "https://api.razorpay.com"
_ID = re.compile(r"^[A-Za-z0-9_]{3,64}$")
_SIG = re.compile(r"^[0-9a-f]{64}$")
MAX_BODY = 64 * 1024
# Razorpay needs a start for the first charge when it creates a subscription; the trial end is told later (WhatsApp connected), so a placeholder far enough away is used until it is known
PLACEHOLDER_DAYS = 14 + 30


class WebhookRejected(Exception):
    """The signature is missing or wrong (the route answers a plain 401)."""


@dataclass(frozen=True)
class CheckoutSession:
    """What the browser needs to open Razorpay's Checkout for ONE subscription."""

    key_id: str
    subscription_id: str


def _safe_id(value: object) -> str | None:
    return value if isinstance(value, str) and _ID.match(value) else None


class RazorpayBilling:
    name = "razorpay"

    def __init__(self, key_id: str, key_secret: str, webhook_secret: str, *, client: httpx.Client | None = None, base_url: str = BASE) -> None:
        if not key_id.startswith("rzp_test_"):
            raise ValueError("BILLING_PROVIDER=razorpay accepts only Razorpay TEST keys (rzp_test_...): live billing is off")
        if not key_secret or not webhook_secret:
            raise ValueError("BILLING_PROVIDER=razorpay needs the key secret and the webhook secret")
        self._key_id = key_id
        self._auth = (key_id, key_secret)
        self._secret = key_secret.encode()
        self._webhook_secret = webhook_secret.encode()
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:   # no key, no secret in a log line or a traceback
        return "RazorpayBilling(<keys hidden>)"

    # ------------------------------------------------------------------ http
    def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            response = self._client.request(method, f"{self._base}{path}", json=body, auth=self._auth)
        except httpx.HTTPError as exc:
            logger.error("razorpay billing unreachable: %s", exc.__class__.__name__)
            raise NotSupportedError("unreachable") from None
        if response.status_code in (400, 402):
            raise PaymentMethodDeclinedError("razorpay")
        if response.status_code >= 300:
            logger.error("razorpay billing refused: %s %s", method, response.status_code)
            raise NotSupportedError(f"status {response.status_code}")
        try:
            doc = response.json()
        except ValueError:
            raise NotSupportedError("not json") from None
        return doc if isinstance(doc, dict) else {}

    def _plan(self, plan_id: str, price_paise: int) -> str:
        """The Razorpay plan for (our plan, monthly price), found by its notes or made once."""
        key = f"{plan_id}:{price_paise}"
        listed = self._call("GET", "/v1/plans?count=100")
        for item in listed.get("items") or []:
            notes = item.get("notes") if isinstance(item, dict) else None
            if isinstance(notes, dict) and notes.get("stack19_plan") == key and _safe_id(item.get("id")):
                return str(item["id"])
        made = self._call("POST", "/v1/plans", {"period": "monthly", "interval": 1, "item": {"name": f"Stack19 {plan_id}"[:100], "amount": price_paise, "currency": "INR"}, "notes": {"stack19_plan": key}})
        pid = _safe_id(made.get("id"))
        if pid is None:
            raise NotSupportedError("bad plan answer")
        return pid

    # ------------------------------------------------------------------ the interface
    def begin_checkout(self, request: CreateSubscription) -> CheckoutSession:
        """Step 1 of a start: the subscription (status `created`, nothing charged) that the browser's Checkout will authorise. A plan with no price cannot be started."""
        if request.price_paise is None or request.price_paise <= 0:
            raise NotSupportedError("the plan has no price")
        start = request.started_at + timedelta(days=request.trial_days if request.trial_days else PLACEHOLDER_DAYS)
        made = self._call("POST", "/v1/subscriptions", {
            "plan_id": self._plan(request.plan_id, request.price_paise), "total_count": 120, "quantity": 1, "customer_notify": False,
            "start_at": int(start.astimezone(UTC).timestamp()), "notes": {"tenant_id": request.tenant_id, "plan": request.plan_id},
        })
        sid = _safe_id(made.get("id"))
        if sid is None:
            raise NotSupportedError("bad subscription answer")
        return CheckoutSession(self._key_id, sid)

    def create_subscription(self, request: CreateSubscription) -> ProviderSubscription:
        """Step 2: the browser returned "<subscription_id>.<payment_id>.<signature>". A wrong signature is a payment method that could not be authorised. Charges nothing."""
        parts = request.checkout_ref.split(".")
        if len(parts) != 3 or not _safe_id(parts[0]) or not _safe_id(parts[1]) or not _SIG.match(parts[2]):
            raise PaymentMethodDeclinedError("checkout_ref")
        subscription_id, payment_id, signature = parts
        expected = hmac.new(self._secret, f"{payment_id}|{subscription_id}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature.encode(), expected.encode()):
            raise PaymentMethodDeclinedError("signature")
        return ProviderSubscription(self.name, subscription_id, None)

    def set_trial_end(self, reference: str, trial_ends_at: datetime) -> None:
        """Razorpay fixes `start_at` when the subscription is made and has no call to move it. The date chosen at checkout stands; a difference is logged for a person (never silently charged early)."""
        try:
            sub = self._call("GET", f"/v1/subscriptions/{reference}")
        except NotSupportedError:
            return
        start = sub.get("start_at")
        if isinstance(start, int) and abs(start - int(trial_ends_at.timestamp())) > 86400:
            logger.warning("razorpay billing: the first charge date differs from the trial end by more than a day (subscription %s)", reference)

    def cancel_subscription(self, reference: str, *, at_period_end: bool, now: datetime) -> None:
        if not _safe_id(reference):
            return
        try:
            self._call("POST", f"/v1/subscriptions/{reference}/cancel", {"cancel_at_cycle_end": 1 if at_period_end else 0})
        except PaymentMethodDeclinedError:
            return   # already cancelled or completed at Razorpay (a 400): cancelling is safe to repeat

    def charge_once(self, charge: OneOffCharge) -> ChargeResult:
        raise NotSupportedError("top-up packs need Razorpay Orders and Checkout (not built yet)")

    def change_plan(self, reference: str, price_paise: int | None) -> None:
        raise NotSupportedError("a plan change is made with a new subscription (not built yet)")

    def events_until(self, now: datetime) -> list[ProviderEvent]:
        return []   # Razorpay tells us by webhook

    def verify_webhook(self, headers: Mapping[str, str], raw_body: bytes) -> list[ProviderEvent]:
        if len(raw_body) > MAX_BODY:
            raise WebhookRejected
        given = headers.get("x-razorpay-signature", "")
        expected = hmac.new(self._webhook_secret, raw_body, hashlib.sha256).hexdigest()
        if not given or not hmac.compare_digest(given.encode(), expected.encode()):
            raise WebhookRejected
        try:
            doc = json.loads(raw_body)
            event = str(doc["event"])
            payload = doc["payload"]
            sub = payload["subscription"]["entity"]
            tenant = sub["notes"]["tenant_id"]
        except (ValueError, KeyError, TypeError):
            return []   # signed, and not about one of our subscriptions
        kinds: dict[str, EventKind] = {"subscription.charged": "charge_succeeded", "subscription.pending": "charge_failed", "subscription.halted": "halted", "subscription.cancelled": "cancelled"}
        kind = kinds.get(event)
        if kind is None or not isinstance(tenant, str) or not _safe_id(tenant.replace("-", "_")):
            return []
        event_id = headers.get("x-razorpay-event-id") or hashlib.sha256(raw_body).hexdigest()[:40]
        amount: int | None = None
        occurred = datetime.now(UTC)
        pay = payload.get("payment", {}).get("entity") if isinstance(payload.get("payment"), dict) else None
        if kind == "charge_succeeded" and isinstance(pay, dict):
            paid = pay.get("amount")
            amount = paid if isinstance(paid, int) and not isinstance(paid, bool) and paid >= 0 else None
            at = pay.get("created_at")
            if isinstance(at, int) and at > 0:
                occurred = datetime.fromtimestamp(at, UTC)
        return [ProviderEvent(f"razorpay:{event_id}"[:120], tenant, kind, amount, occurred)]
