# ruff: noqa: E501
"""The number picker's buyer (28 Nov 2026) against a FAKE VoiceLink: every check that can refuse runs before the one call that spends money, and nothing here ever talks to the real service."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.numbers.buyer import BuyerSettings, PickerRefused, buy
from app.telephony.voicelink_api import VoicelinkApi

SETTINGS = BuyerSettings(client_id=5879, bot_id=1362)
NUMBER = "+919876543210"


class Fake:
    """VoiceLink's purchase side: a wallet, one number for sale, and a log of every call we make."""

    def __init__(self, *, balance: float = 4000, rate: float = 299, listed: bool = True, lock_refused: bool = False, summary: dict[str, Any] | None = None, map_fails: bool = False, route_fails: bool = False, confirm_fails: bool = False) -> None:
        self.balance, self.rate, self.listed, self.lock_refused, self.map_fails, self.route_fails, self.confirm_fails = balance, rate, listed, lock_refused, map_fails, route_fails, confirm_fails
        self.summary = summary or {"total": rate, "did_count": 1, "channel_count": 0, "wallet_balance": balance}
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        path = request.url.path
        self.calls.append((request.method, path, body))
        if path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"access_token": "t"}, "status": True})
        if path.endswith("/reseller/profile"):
            return httpx.Response(200, json={"data": {"wallet": {"balance": self.balance, "currency": "INR"}}, "status": True})
        if path.endswith("/reseller/purchase/dids"):
            rows = [{"id": 31, "did_type": 2, "did_number": "+919876543210", "type_label": "Mobile", "monthly_rate": self.rate, "total_price": self.rate}] if self.listed else []
            return httpx.Response(200, json={"data": {"data": rows}, "status": True})
        if path.endswith("/reseller/purchase/lock-did"):
            if self.lock_refused:
                return httpx.Response(422, json={"status": False})
            return httpx.Response(200, json={"data": {"order_id": 5, "locked_dids": [{"did_id": 31, "total_price": self.rate}], "order_number": "ORD-1"}, "status": True})
        if "/reseller/purchase/summary/" in path:
            return httpx.Response(200, json={"data": self.summary, "status": True})
        if path.endswith("/reseller/purchase/confirm"):
            return httpx.Response(500) if self.confirm_fails else httpx.Response(200, json={"data": {"order_number": "ORD-1", "total": self.rate}, "status": True})
        if path.endswith("/reseller/client/map-did"):
            return httpx.Response(422, json={"status": False}) if self.map_fails else httpx.Response(200, json={"data": {"did_id": 31}, "status": True})
        if path.endswith("/call-routing/create"):
            return httpx.Response(422, json={"status": False}) if self.route_fails else httpx.Response(200, json={"data": {"id": 9}, "status": True})
        return httpx.Response(404)

    def api(self) -> VoicelinkApi:
        return VoicelinkApi("u", "p", client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(self.handler)))

    def paths(self) -> list[str]:
        return [p.split("/api/v1")[-1] for _, p, _ in self.calls]


def test_a_good_purchase_runs_in_order_and_maps_the_number_with_recording_off_to_our_bot() -> None:
    fake = Fake()
    bought = buy(fake.api(), SETTINGS, NUMBER, "mobile")
    assert bought.complete and bought.number == NUMBER and bought.order_number == "ORD-1" and bought.cost_inr == 299
    order = [p for p in fake.paths() if "purchase" in p or "map-did" in p or "routing" in p]
    assert order == ["/reseller/purchase/dids", "/reseller/purchase/lock-did", "/reseller/purchase/summary/5", "/reseller/purchase/confirm", "/reseller/client/map-did", "/call-routing/create"]
    mapped = next(b for _, p, b in fake.calls if p.endswith("map-did"))
    assert mapped == {"did_id": 31, "client_id": 5879, "user_status": 2, "call_recording": 0, "description": "Stack19 customer number"}, "recording OFF, assigned to our client"
    routed = next(b for _, p, b in fake.calls if p.endswith("call-routing/create"))
    assert routed["for_inbound_call"] == 3 and routed["for_outbound_call"] == 3 and routed["inbound_websocket_bot_id"] == 1362


@pytest.mark.parametrize(
    ("fake", "reason"),
    [
        (Fake(balance=900), "wallet_low"),
        (Fake(listed=False), "number_taken"),
        (Fake(lock_refused=True), "number_taken"),
        (Fake(rate=650, summary={"total": 650, "did_count": 1, "channel_count": 0, "wallet_balance": 4000}), "rate_too_high"),
        (Fake(summary={"total": 299, "did_count": 1, "channel_count": 2, "wallet_balance": 4000}), "rate_too_high"),
        (Fake(summary={"total": 299, "did_count": 2, "channel_count": 0, "wallet_balance": 4000}), "rate_too_high"),
        (Fake(summary={"total": 299, "did_count": 1, "channel_count": 0, "wallet_balance": 100}), "rate_too_high"),
        (Fake(summary={"total": 900, "did_count": 1, "channel_count": 0, "wallet_balance": 4000}), "rate_too_high"),
        (Fake(confirm_fails=True), "vendor_unavailable"),
    ],
)
def test_every_refusal_happens_before_the_money_moves(fake: Fake, reason: str) -> None:
    with pytest.raises(PickerRefused) as why:
        buy(fake.api(), SETTINGS, NUMBER, "mobile")
    assert why.value.reason == reason
    spent = [p for p in fake.paths() if p.endswith("/purchase/confirm")]
    if reason != "vendor_unavailable":
        assert spent == [], "confirm (the call that spends money) is never reached"


def test_a_wallet_below_the_floor_asks_nothing_about_numbers() -> None:
    fake = Fake(balance=999)
    with pytest.raises(PickerRefused):
        buy(fake.api(), SETTINGS, NUMBER, "mobile")
    assert not any("purchase" in p for p in fake.paths())


def test_after_the_purchase_a_failed_set_up_is_reported_not_raised_and_says_how_far_it_got() -> None:
    mapped_fails = buy((f := Fake(map_fails=True)).api(), SETTINGS, NUMBER, "mobile")
    assert mapped_fails.stage == "bought" and not mapped_fails.complete and not any(p.endswith("call-routing/create") for p in f.paths())
    routed_fails = buy(Fake(route_fails=True).api(), SETTINGS, NUMBER, "mobile")
    assert routed_fails.stage == "mapped" and not routed_fails.complete


def test_an_unknown_type_and_a_garbled_number_are_refused_without_a_call() -> None:
    fake = Fake()
    with pytest.raises(PickerRefused):
        buy(fake.api(), SETTINGS, NUMBER, "toll-free")
    with pytest.raises(PickerRefused):
        buy(fake.api(), SETTINGS, "12345", "mobile")
    assert not any("purchase" in p for p in fake.paths())


def test_with_recording_expected_the_number_is_given_over_with_recording_on() -> None:
    """28 Nov 2026 (owner, option B): VOICELINK_RECORDING_EXPECTED turns recording ON for a bought number, so the opening's notice is true."""
    fake = Fake()
    buy(fake.api(), BuyerSettings(client_id=5879, bot_id=1362, recording=True), NUMBER, "mobile")
    mapped = next(b for _, p, b in fake.calls if p.endswith("map-did"))
    assert mapped["call_recording"] == 1
