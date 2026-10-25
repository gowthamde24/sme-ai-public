"""The FAKE billing provider (job DI, ADR 0092): a deterministic stand-in for Razorpay Subscriptions with UPI AutoPay. In memory, no network, no clock of its own (`now` is always given), no secret.

The payment method reference decides what happens, so every case can be tested and clicked through:
  pm_fake_ok                     every charge succeeds
  pm_fake_declined               the payment method cannot be authorised: the trial does not start
  pm_fake_declines_on_renewal    the trial starts; the FIRST charge (at the end of the trial) fails, is retried 3 days later (fails) and the provider gives up at the end of the grace period (`halted`)
  pm_fake_declines_after_first   the first charge succeeds; the second (one month later) fails, and so on as above
A month is 30 days here (a real provider uses calendar months; the database applies the real month to the period it stores)."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.billing.errors import NotSupportedError, PaymentMethodDeclinedError
from app.billing.provider import CreateSubscription, EventKind, ProviderEvent, ProviderSubscription

OK = "pm_fake_ok"
DECLINED = "pm_fake_declined"
DECLINES_ON_RENEWAL = "pm_fake_declines_on_renewal"
DECLINES_AFTER_FIRST = "pm_fake_declines_after_first"
KNOWN = {OK, DECLINED, DECLINES_ON_RENEWAL, DECLINES_AFTER_FIRST}
MONTH = timedelta(days=30)
RETRY_AFTER = timedelta(days=3)
GIVE_UP_AFTER = timedelta(days=7)


@dataclass
class _Subscription:
    tenant_id: str
    checkout_ref: str
    price_paise: int | None
    first_charge_at: datetime | None   # None until set_trial_end: the trial counts from the day WhatsApp is connected
    cancelled_at: datetime | None = None
    ends_at: datetime | None = None   # a cancel at the end of the paid period: when it ends
    handed_out: set[str] = field(default_factory=set)


class FakeBillingProvider:
    name = "fake"

    def __init__(self) -> None:
        self._subs: dict[str, _Subscription] = {}

    def create_subscription(self, request: CreateSubscription) -> ProviderSubscription:
        if request.checkout_ref not in KNOWN or request.checkout_ref == DECLINED:
            raise PaymentMethodDeclinedError(request.checkout_ref)
        # a reference that does not repeat for the same request but is stable for it: the idempotency of a retried start
        digest = hashlib.sha256(f"{request.tenant_id}:{request.plan_id}:{request.checkout_ref}:{request.started_at.isoformat()}".encode()).hexdigest()[:20]
        reference = f"sub_fake_{digest}"
        self._subs.setdefault(reference, _Subscription(request.tenant_id, request.checkout_ref, request.price_paise, None))
        return ProviderSubscription(self.name, reference, None)

    def set_trial_end(self, reference: str, trial_ends_at: datetime) -> None:
        sub = self._subs.get(reference)
        if sub is not None and sub.first_charge_at is None and sub.cancelled_at is None:
            sub.first_charge_at = trial_ends_at

    def cancel_subscription(self, reference: str, *, at_period_end: bool, now: datetime) -> None:
        sub = self._subs.get(reference)
        if sub is None or sub.cancelled_at is not None:
            return
        sub.cancelled_at = now
        if at_period_end and sub.first_charge_at is not None and now >= sub.first_charge_at:
            elapsed = (now - sub.first_charge_at) // MONTH + 1
            sub.ends_at = sub.first_charge_at + elapsed * MONTH
        else:
            sub.ends_at = now   # during the trial, or at once: nothing will ever be charged

    def verify_webhook(self, headers: Mapping[str, str], raw_body: bytes) -> list[ProviderEvent]:
        raise NotSupportedError("the fake provider receives no webhooks")

    def events_until(self, now: datetime) -> list[ProviderEvent]:
        out: list[ProviderEvent] = []
        for reference, sub in self._subs.items():
            out.extend(self._events_of(reference, sub, now))
        return sorted(out, key=lambda e: (e.occurred_at, e.event_id))

    # ------------------------------------------------------------------------------------------------
    def _events_of(self, reference: str, sub: _Subscription, now: datetime) -> list[ProviderEvent]:
        events: list[ProviderEvent] = []

        def emit(key: str, kind: EventKind, at: datetime, amount: int | None = None) -> None:
            event_id = f"{reference}:{key}"
            if sub.cancelled_at is not None and at > sub.cancelled_at and kind != "cancelled":
                return   # a cancelled subscription is not retried and not charged again
            if at <= now and event_id not in sub.handed_out:
                sub.handed_out.add(event_id)
                events.append(ProviderEvent(event_id, sub.tenant_id, kind, amount, at))

        if sub.price_paise is None or sub.first_charge_at is None:
            return events   # no price, no charge: the schedule does not run until the owner of the product sets one; and none runs until the trial's end is known (WhatsApp connected)
        end = sub.ends_at
        cycle = 0
        while True:
            due = sub.first_charge_at + cycle * MONTH
            if due > now or (end is not None and due >= end):
                break
            fails = (sub.checkout_ref == DECLINES_ON_RENEWAL and cycle == 0) or (sub.checkout_ref == DECLINES_AFTER_FIRST and cycle >= 1)
            if not fails:
                emit(f"charge:{cycle}", "charge_succeeded", due, sub.price_paise)
                cycle += 1
                continue
            emit(f"charge:{cycle}:failed", "charge_failed", due)
            emit(f"charge:{cycle}:retry", "charge_failed", due + RETRY_AFTER)
            emit(f"halted:{cycle}", "halted", due + GIVE_UP_AFTER)
            break   # after a halt the schedule is over
        if end is not None:
            emit("cancelled", "cancelled", end)
        return events
