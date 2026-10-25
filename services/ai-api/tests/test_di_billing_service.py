"""Job DI: the billing service with the FAKE provider and an in-memory repository (no database, no network): the order of the provider and the record, the trial, the cancel before day 30 (no charge), the
renewals, the failed payments, repeated events, and the usage gate. The database's rules are in supabase/tests/database/111_di_billing.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.billing import fake
from app.billing.errors import (
    NothingToCancelError,
    PaymentMethodDeclinedError,
    PlanLimitReachedError,
    PlanUnknownError,
    TrialAlreadyStartedError,
)
from app.billing.fake import FakeBillingProvider
from app.billing.provider import build_provider
from app.billing.service import BillingService, UsageGate
from app.tenancy.repository import UpstreamError
from tests.di_fakes import FakeBillingRepository

T = uuid.UUID(int=0xA)
T0 = datetime(2026, 10, 14, 11, 0, tzinfo=UTC)
TOKEN = "owner-token"  # noqa: S105
WORKER = "channel-token"  # noqa: S105


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now


def world(price: int | None = None) -> tuple[BillingService, FakeBillingRepository, FakeBillingProvider, Clock]:
    repo, provider, clock = FakeBillingRepository(price_paise=price), FakeBillingProvider(), Clock()
    return BillingService(repo, provider, clock=clock), repo, provider, clock


def events_for(service: BillingService, days: int, clock: Clock) -> list[str]:
    clock.now = T0 + timedelta(days=days)
    return [f"{a.kind}:{a.status}" for a in service.advance(WORKER)]


# ---------------------------------------------------------------------------------------------- the start
def test_a_trial_starts_with_a_payment_method_and_charges_nothing() -> None:
    service, repo, provider, clock = world(price=99900)
    out = service.start_trial(TOKEN, T, "growth", fake.OK)
    assert out["subscription"]["status"] == "trialing" and out["can_start_trial"] is False
    assert len(provider._subs) == 1 and repo.events == []
    assert events_for(service, 29, clock) == [], "nothing happens, nothing is charged, during the 30 days"


def test_the_trial_plan_and_unknown_plans_cannot_be_subscribed_to() -> None:
    service, repo, provider, _ = world()
    for plan in ("free_trial", "platinum"):
        with pytest.raises(PlanUnknownError):
            service.start_trial(TOKEN, T, plan, fake.OK)
    assert provider._subs == {} and repo.subs == {}


def test_a_declined_payment_method_creates_nothing() -> None:
    service, repo, provider, _ = world()
    for ref in (fake.DECLINED, "pm_unknown_card"):
        with pytest.raises(PaymentMethodDeclinedError):
            service.start_trial(TOKEN, T, "growth", ref)
    assert provider._subs == {} and repo.subs == {}, "no subscription at the provider and none in our records"


def test_a_second_trial_is_refused_before_the_provider_is_asked() -> None:
    service, _, provider, _ = world()
    service.start_trial(TOKEN, T, "growth", fake.OK)
    with pytest.raises(TrialAlreadyStartedError):
        service.start_trial(TOKEN, T, "business", fake.OK)
    assert len(provider._subs) == 1, "no orphan subscription was made at the provider"


def test_if_the_record_fails_the_providers_subscription_is_cancelled_at_once() -> None:
    service, repo, provider, clock = world(price=99900)
    repo.fail_start = UpstreamError("down")
    with pytest.raises(UpstreamError):
        service.start_trial(TOKEN, T, "growth", fake.OK)
    assert events_for(service, 400, clock) == [], "the orphan can never charge: it was cancelled"


# ---------------------------------------------------------------------------------------------- cancel
def test_cancel_before_day_30_is_no_charge_ever() -> None:
    service, repo, provider, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.OK)
    clock.now = T0 + timedelta(days=12)
    out = service.cancel(TOKEN, T)
    assert out["subscription"]["status"] == "cancelled" and out["subscription"]["payment_method_on_file"] is False
    applied = events_for(service, 400, clock)
    assert all(not a.startswith("charge") for a in applied), applied
    assert not [e for e in repo.events if e[2].startswith("charge")], "not one charge in a year"


def test_cancel_tells_the_provider_before_the_record() -> None:
    service, repo, provider, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.OK)
    order: list[str] = []
    real_cancel, real_record = provider.cancel_subscription, repo.cancel
    provider.cancel_subscription = lambda *a, **k: (order.append("provider"), real_cancel(*a, **k))[1]  # type: ignore[method-assign]
    repo.cancel = lambda *a, **k: (order.append("record"), real_record(*a, **k))[1]  # type: ignore[method-assign]
    service.cancel(TOKEN, T)
    assert order == ["provider", "record"]


def test_nothing_to_cancel_without_a_subscription_or_twice() -> None:
    service, _, _, _ = world()
    with pytest.raises(NothingToCancelError):
        service.cancel(TOKEN, T)
    service.start_trial(TOKEN, T, "growth", fake.OK)
    service.cancel(TOKEN, T)
    with pytest.raises(NothingToCancelError):
        service.cancel(TOKEN, T)


# ---------------------------------------------------------------------------------------------- charges
def test_the_first_charge_comes_at_the_end_of_the_trial_and_then_every_month() -> None:
    service, repo, _, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.OK)
    assert events_for(service, 31, clock) == ["charge_succeeded:active"]
    assert repo.plan_of[T] == "growth", "the chosen plan starts"
    assert events_for(service, 31, clock) == [], "asked again: the same event is not handed out twice"
    assert events_for(service, 61, clock) == ["charge_succeeded:active"], "the renewal one month later"
    assert [e[2] for e in repo.events] == ["charge_succeeded", "charge_succeeded"]


def test_with_no_price_set_nothing_is_ever_charged() -> None:
    service, repo, _, clock = world(price=None)
    service.start_trial(TOKEN, T, "growth", fake.OK)
    assert events_for(service, 200, clock) == [], "a price that is not decided is never made up"
    assert repo.subs[T]["status"] == "trialing"


def test_a_failed_first_payment_is_past_due_then_the_provider_gives_up() -> None:
    service, repo, _, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.DECLINES_ON_RENEWAL)
    assert events_for(service, 31, clock) == ["charge_failed:past_due"]
    assert repo.plan_of.get(T, "free_trial") == "free_trial", "the plan has not changed"
    assert events_for(service, 34, clock) == ["charge_failed:past_due"], "the retry three days later fails too"
    assert events_for(service, 38, clock) == ["halted:cancelled"], "after the grace period the provider gives up"
    assert repo.plan_of[T] == "free_trial"
    assert events_for(service, 100, clock) == [], "a halted subscription charges nothing more"


def test_cancelling_after_a_failed_payment_ends_it_at_once_and_stops_the_retries() -> None:
    service, repo, _, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.DECLINES_ON_RENEWAL)
    assert events_for(service, 31, clock) == ["charge_failed:past_due"]
    out = service.cancel(TOKEN, T)
    assert out["subscription"]["status"] == "cancelled" and out["subscription"]["payment_method_on_file"] is False
    later = events_for(service, 60, clock)
    assert later == ["cancelled:cancelled"], later   # no retry, no halt, no charge: only the end
    assert [e[2] for e in repo.events] == ["charge_failed", "cancelled"]


def test_a_failed_renewal_after_a_good_first_payment() -> None:
    service, repo, _, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.DECLINES_AFTER_FIRST)
    assert events_for(service, 31, clock) == ["charge_succeeded:active"]
    assert events_for(service, 61, clock) == ["charge_failed:past_due"]
    assert repo.plan_of[T] == "growth", "the plan is kept during the grace period"
    assert events_for(service, 68, clock) == ["charge_failed:past_due", "halted:cancelled"]
    assert repo.plan_of[T] == "free_trial"


def test_cancelling_an_active_plan_ends_it_at_the_end_of_the_paid_period() -> None:
    service, repo, _, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.OK)
    assert events_for(service, 31, clock) == ["charge_succeeded:active"]
    clock.now = T0 + timedelta(days=40)
    out = service.cancel(TOKEN, T)
    assert out["subscription"]["cancel_at_period_end"] is True and out["subscription"]["status"] == "active"
    assert events_for(service, 55, clock) == [], "the paid period runs on"
    assert events_for(service, 62, clock) == ["cancelled:cancelled"], "and ends at its end, with no further charge"
    assert [e[2] for e in repo.events] == ["charge_succeeded", "cancelled"]


def test_the_same_event_applied_twice_changes_nothing() -> None:
    service, repo, provider, clock = world(price=99900)
    service.start_trial(TOKEN, T, "growth", fake.OK)
    clock.now = T0 + timedelta(days=31)
    event = provider.events_until(clock.now)[0]
    service.apply(WORKER, event)
    service.apply(WORKER, event)
    assert len(repo.events) == 1


def test_a_provider_without_webhooks_says_so_and_only_the_fake_exists() -> None:
    with pytest.raises(Exception, match="no webhooks"):
        FakeBillingProvider().verify_webhook({}, b"{}")
    assert build_provider("fake").name == "fake"
    for name in ("razorpay", "stripe", ""):
        with pytest.raises(ValueError, match="fake"):
            build_provider(name)


# ---------------------------------------------------------------------------------------------- the usage gate
def test_the_gate_lets_a_kind_begin_until_it_is_stopped() -> None:
    _, repo, _, _ = world()
    gate = UsageGate(repo)
    assert gate.ensure_allowed(TOKEN, T, "call_minutes")["allowed"] is True
    repo.stopped.add("call_minutes")
    with pytest.raises(PlanLimitReachedError) as stopped:
        gate.ensure_allowed(TOKEN, T, "call_minutes")
    assert stopped.value.kind == "call_minutes"
    assert gate.ensure_allowed(TOKEN, T, "whatsapp_messages")["allowed"] is True, "the other kind is its own"
    with pytest.raises(ValueError, match="kind"):
        gate.ensure_allowed(TOKEN, T, "quotes")


def test_call_seconds_are_recorded_with_the_channel_accounts_token() -> None:
    _, repo, _, _ = world()
    call = uuid.uuid4()
    UsageGate(repo).record_call_seconds(WORKER, T, call, 95)
    assert repo.usage_records == [(WORKER, T, "call_minutes", call, 95)]
