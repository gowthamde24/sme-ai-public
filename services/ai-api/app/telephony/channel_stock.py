"""Buying channels for OUR pool (a stock for new businesses' clients; VoiceLink needs one free channel per client). The only place that calls the channel purchase endpoints; behind VOICELINK_CHANNEL_BUY (off).

The calls, exactly three and no number (the real account accepted this order on 26 Nov 2026): `purchase/add-channel` -> `purchase/summary/{id}` -> `purchase/confirm`. Every check that can refuse comes BEFORE the confirm, the one call that spends
money, as in app/numbers/buyer.py:
  1. the switch is on                                                        -> switch_off
  2. the count is 1 to MAX_COUNT                                             -> bad_count
  3. the draft's own total is within the hard cap (VOICELINK_CHANNEL_BUY_MAX_INR, default Rs 200)   -> price_too_high
  4. VoiceLink's summary says: no number, exactly the channels asked, a total within the cap       -> unexpected_order / price_too_high
  5. the wallet keeps at least the floor after paying (default Rs 500)       -> wallet_low
A refusal after the draft leaves an unpaid draft order at VoiceLink (it charges nothing). Closed words only; no price or id is put in a message or log line."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.telephony.voicelink_api import VoicelinkApi, VoicelinkError

log = logging.getLogger("app.telephony.channel_stock")
MAX_COUNT = 3


class ChannelBuyRefused(Exception):
    """A closed reason: `switch_off`, `bad_count`, `price_too_high`, `unexpected_order`, `wallet_low`, `vendor_unavailable`."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ChannelBuySettings:
    enabled: bool = False
    max_total_inr: float = 200.0
    wallet_floor_inr: float = 500.0
    months: int = 1


@dataclass(frozen=True)
class ChannelsBought:
    count: int
    order_number: str
    total_inr: float   # for our audit; never shown to a customer


def buy_channels(api: VoicelinkApi, settings: ChannelBuySettings, count: int = 1) -> ChannelsBought:
    if not settings.enabled:
        raise ChannelBuyRefused("switch_off")
    if isinstance(count, bool) or not 1 <= count <= MAX_COUNT:
        raise ChannelBuyRefused("bad_count")
    try:
        draft = api.add_channel(count=count, months=settings.months)
        if draft.total > settings.max_total_inr:
            raise ChannelBuyRefused("price_too_high")
        summary = api.order_summary(draft.order_id)
    except VoicelinkError as exc:
        log.warning("channel_buy vendor_failed reason=%s", exc.reason)
        raise ChannelBuyRefused("vendor_unavailable") from None
    if summary.did_count != 0 or summary.channel_count != count:
        raise ChannelBuyRefused("unexpected_order")   # a number in the order, or not the channels we asked for: nothing is confirmed
    if summary.total > settings.max_total_inr:
        raise ChannelBuyRefused("price_too_high")
    if summary.wallet_balance - summary.total < settings.wallet_floor_inr:
        raise ChannelBuyRefused("wallet_low")
    try:
        number = api.confirm_purchase(draft.order_id)   # THE PURCHASE: paid from our wallet
    except VoicelinkError as exc:
        log.warning("channel_buy confirm_failed reason=%s", exc.reason)
        raise ChannelBuyRefused("vendor_unavailable") from None
    return ChannelsBought(count=count, order_number=number, total_inr=summary.total)
