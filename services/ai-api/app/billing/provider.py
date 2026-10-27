"""The billing provider interface (job DI, ADR 0092). Only a FAKE provider exists; a real one (Razorpay Subscriptions with UPI AutoPay) is added later behind this same interface, and nothing here calls a network.

The shape follows how subscription providers actually work, so that the real one is an adapter and not a rewrite:
  * the browser's checkout (the provider's own page) collects the payment method and returns a REFERENCE (`checkout_ref`); our servers never see a card or a UPI detail;
  * `create_subscription` registers the subscription at the provider; it charges NOTHING during the trial and refuses a payment method that cannot be authorised. The trial is 14 days counted from the day the
    workspace's WhatsApp is connected, so the day of the first charge is told later with `set_trial_end` (the worker does it);
  * the provider then runs the schedule (the first charge at the end of the trial, one every month, retries after a failure) and TELLS US with events: `charge_succeeded`, `charge_failed`, `halted`
    (it gave up) and `cancelled`. A real provider delivers them by webhook (`verify_webhook` checks the signature of the raw body); the fake provider produces the same events from a clock (`events_until`);
  * every event has an id; applying an event twice changes nothing (the database keeps the ids);
  * `cancel_subscription` stops the schedule at the provider: at once during the trial, or at the end of the paid period.
Prices come from the plans catalogue and are null today: a charge with no price is never made up (`price_paise` None means the provider produces no charge event)."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

EventKind = Literal["charge_succeeded", "charge_failed", "halted", "cancelled"]


@dataclass(frozen=True)
class CreateSubscription:
    tenant_id: str
    plan_id: str
    checkout_ref: str
    trial_days: int
    # the plan's monthly price in paise, or None while the owner of the product has not set it
    price_paise: int | None
    started_at: datetime


@dataclass(frozen=True)
class ProviderSubscription:
    provider: str
    reference: str
    # None = the provider does not know yet when the trial ends: the 14 days count from the day the workspace's WhatsApp is connected (`set_trial_end` tells it then)
    trial_ends_at: datetime | None = None


@dataclass(frozen=True)
class ProviderEvent:
    event_id: str
    tenant_id: str
    kind: EventKind
    amount_paise: int | None
    occurred_at: datetime


@dataclass(frozen=True)
class OneOffCharge:
    """A single payment outside the monthly schedule (a top-up pack, the pro-rata of an upgrade). `idempotency_key` makes a retry harmless at the provider."""

    tenant_id: str
    checkout_ref: str
    amount_paise: int
    description: str
    idempotency_key: str


@dataclass(frozen=True)
class ChargeResult:
    provider: str
    reference: str


class BillingProvider(Protocol):
    name: str

    def create_subscription(self, request: CreateSubscription) -> ProviderSubscription:
        """Register the subscription with a trial. Raises PaymentMethodDeclinedError when the payment method cannot be authorised. Charges nothing."""
        ...

    def set_trial_end(self, reference: str, trial_ends_at: datetime) -> None:
        """Tell the provider the day the trial ends, which is the day of the first charge. The trial counts from the day the workspace's WhatsApp is connected (owner decision 25 Oct 2026), so this is known
        only then. Safe to repeat for the same day."""
        ...

    def cancel_subscription(self, reference: str, *, at_period_end: bool, now: datetime) -> None:
        """Stop the schedule. Unknown or already cancelled: nothing happens (cancelling is safe to repeat)."""
        ...

    def charge_once(self, charge: OneOffCharge) -> ChargeResult:
        """Take one payment now. Raises PaymentMethodDeclinedError when the payment method is refused; then nothing was charged. The same idempotency key never charges twice."""
        ...

    def change_plan(self, reference: str, price_paise: int | None) -> None:
        """From the next charge on, the subscription costs `price_paise` a month (an upgrade). Unknown reference: nothing happens."""
        ...

    def events_until(self, now: datetime) -> list[ProviderEvent]:
        """The events that fell due up to `now` and were not handed out before. Only a provider with its own clock (the fake one) answers; a real provider uses a webhook."""
        ...

    def verify_webhook(self, headers: Mapping[str, str], raw_body: bytes) -> list[ProviderEvent]:
        """Check the signature of the raw body and read the events. Raises NotSupportedError for a provider without webhooks."""
        ...


def build_provider(name: str) -> BillingProvider:
    """The provider named by BILLING_PROVIDER: only `fake` exists. Anything else stops the process at start rather than silently choosing one."""
    if name == "fake":
        from app.billing.fake import FakeBillingProvider

        return FakeBillingProvider()
    raise ValueError("BILLING_PROVIDER must be 'fake' (no real provider exists yet)")
