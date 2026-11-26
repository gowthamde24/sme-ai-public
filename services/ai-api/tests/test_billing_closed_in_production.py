"""Production takes payments only from a LIVE account (26 Nov 2026): the fake provider (signature `sig_fake_ok`) and a Razorpay TEST payment would be free money on a real wallet, so a production API without a live
account gets the closed provider and every payment door answers "not available". Development and staging are untouched."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.billing.errors import NotSupportedError
from app.billing.provider import ClosedBilling, OrderRequest
from app.config import Settings
from app.main import _billing_provider


def settings(**kw: Any) -> Settings:
    return Settings(**kw)


KEYS: dict[str, Any] = {"billing_razorpay_key_id": "rzp_test_ABCDEFGH123456", "billing_razorpay_key_secret": "s" * 24, "billing_razorpay_webhook_secret": "w" * 24}


def test_production_with_the_fake_provider_is_closed() -> None:
    assert isinstance(_billing_provider(settings(api_env="production", billing_provider="fake")), ClosedBilling)


def test_production_with_a_razorpay_test_key_is_closed() -> None:
    assert isinstance(_billing_provider(settings(api_env="production", billing_provider="razorpay", **KEYS)), ClosedBilling)


def test_production_with_a_live_key_and_the_owners_flag_is_the_real_provider() -> None:
    live = {**KEYS, "billing_razorpay_key_id": "rzp_live_ABCDEFGH123456"}   # a fake, synthetic key id (not a real account)
    provider = _billing_provider(settings(api_env="production", billing_provider="razorpay", razorpay_live_ok=True, **live))
    assert provider.mode == "live" and not isinstance(provider, ClosedBilling)


@pytest.mark.parametrize("env", ["development", "staging"])
def test_development_and_staging_keep_the_fake_and_the_test_provider(env: str) -> None:
    assert _billing_provider(settings(api_env=env, billing_provider="fake")).name == "fake"
    assert _billing_provider(settings(api_env=env, billing_provider="razorpay", **KEYS)).mode == "test"


def test_the_closed_provider_pays_nothing_and_credits_nothing() -> None:
    closed = ClosedBilling()
    assert closed.verify_order_payment("order_x", "pay_fake_x", "sig_fake_ok") is False, "the fake provider's own signature is worthless here"
    with pytest.raises(NotSupportedError):
        closed.create_order(OrderRequest(tenant_id="t", purpose="topup", amount_paise=10000, receipt="r"))
    with pytest.raises(NotSupportedError):
        closed.verify_webhook({}, b"{}")
    assert closed.events_until(datetime.now(UTC)) == []
