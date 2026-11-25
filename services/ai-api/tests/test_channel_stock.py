"""Buying channels for our pool: three calls and no number, with every guard before the confirm (app/telephony/channel_stock.py). A FAKE VoiceLink only (httpx MockTransport); nothing real."""

# ruff: noqa: E501
from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.telephony.channel_stock import ChannelBuyRefused, ChannelBuySettings, buy_channels
from app.telephony.voicelink_api import VoicelinkApi

ON = ChannelBuySettings(enabled=True)


class Fake:
    def __init__(self, *, rate: float = 19.8, wallet: float = 4137.5, summary: dict[str, Any] | None = None, down: bool = False) -> None:
        self.rate, self.wallet, self.down = rate, wallet, down
        self.summary_override = summary
        self.calls: list[tuple[str, str, Any]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.replace("/api/v1", "")
        if path == "/auth/login":
            return httpx.Response(200, json={"data": {"access_token": "t"}})
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.method, path, body))
        if self.down:
            return httpx.Response(503, json={})
        if path == "/reseller/purchase/add-channel":
            return httpx.Response(200, json={"status": True, "data": {"order_id": 38270, "channel_count": body["channel_count"], "channel_total": self.rate * body["channel_count"], "channel_monthly_rate": 99}})
        if path == "/reseller/purchase/summary/38270":
            doc = {"total": self.rate * (self.calls[0][2]["channel_count"]), "did_count": 0, "channel_count": self.calls[0][2]["channel_count"], "wallet_balance": self.wallet}
            return httpx.Response(200, json={"status": True, "data": {**doc, **(self.summary_override or {})}})
        if path == "/reseller/purchase/confirm":
            return httpx.Response(200, json={"status": True, "data": {"order_number": "ORD-FAKE-1"}})
        return httpx.Response(404, json={"status": False})


def api_for(fake: Fake) -> VoicelinkApi:
    return VoicelinkApi("u", "p", base_url="https://vl.test/api/v1", client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(fake.handler)))


def paths(fake: Fake) -> list[str]:
    return [c[1] for c in fake.calls]


def test_one_channel_is_three_calls_and_no_number() -> None:
    fake = Fake()
    got = buy_channels(api_for(fake), ON)
    assert paths(fake) == ["/reseller/purchase/add-channel", "/reseller/purchase/summary/38270", "/reseller/purchase/confirm"]
    assert fake.calls[0][2] == {"channel_count": 1, "months": 1} and fake.calls[2][2] == {"order_id": 38270}
    assert got.count == 1 and got.order_number == "ORD-FAKE-1" and got.total_inr == pytest.approx(19.8)
    assert not any("lock-did" in p for p in paths(fake))


def test_the_switch_is_off_by_default_and_nothing_is_called() -> None:
    fake = Fake()
    with pytest.raises(ChannelBuyRefused) as err:
        buy_channels(api_for(fake), ChannelBuySettings())
    assert err.value.reason == "switch_off" and fake.calls == []


@pytest.mark.parametrize("count", [0, 4, -1, True])
def test_a_bad_count_is_refused_before_any_call(count: Any) -> None:
    fake = Fake()
    with pytest.raises(ChannelBuyRefused) as err:
        buy_channels(api_for(fake), ON, count)
    assert err.value.reason == "bad_count" and fake.calls == []


def test_a_total_over_the_hard_cap_is_never_confirmed() -> None:
    fake = Fake(rate=150.0)
    with pytest.raises(ChannelBuyRefused) as err:
        buy_channels(api_for(fake), ON, 2)   # 2 x 150 = 300 > 200
    assert err.value.reason == "price_too_high" and "/reseller/purchase/confirm" not in paths(fake)
    summary_higher = Fake(summary={"total": 250})
    with pytest.raises(ChannelBuyRefused) as err2:
        buy_channels(api_for(summary_higher), ON)
    assert err2.value.reason == "price_too_high" and "/reseller/purchase/confirm" not in paths(summary_higher), "the summary's own total is checked too, not only the draft's"


@pytest.mark.parametrize("override", [{"did_count": 1}, {"channel_count": 2}, {"channel_count": 0}])
def test_an_order_that_is_not_exactly_the_channels_asked_is_refused(override: dict[str, Any]) -> None:
    fake = Fake(summary=override)
    with pytest.raises(ChannelBuyRefused) as err:
        buy_channels(api_for(fake), ON)
    assert err.value.reason == "unexpected_order" and "/reseller/purchase/confirm" not in paths(fake)


def test_it_refuses_when_the_wallet_would_drop_below_the_floor() -> None:
    fake = Fake(wallet=510.0)   # 510 - 19.8 < 500
    with pytest.raises(ChannelBuyRefused) as err:
        buy_channels(api_for(fake), ON)
    assert err.value.reason == "wallet_low" and "/reseller/purchase/confirm" not in paths(fake)
    ok = Fake(wallet=520.0)
    assert buy_channels(api_for(ok), ON).count == 1
    assert buy_channels(api_for(Fake(wallet=100.0)), ChannelBuySettings(enabled=True, wallet_floor_inr=50.0)).count == 1, "the floor is a setting"


def test_a_vendor_that_does_not_answer_is_a_closed_word_and_nothing_is_confirmed() -> None:
    fake = Fake(down=True)
    with pytest.raises(ChannelBuyRefused) as err:
        buy_channels(api_for(fake), ON)
    assert err.value.reason == "vendor_unavailable" and "/reseller/purchase/confirm" not in paths(fake)
