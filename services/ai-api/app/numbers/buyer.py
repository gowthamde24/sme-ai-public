"""Buying ONE phone number from VoiceLink with OUR money (28 Nov 2026). The only place that calls the purchase endpoints.

The order of the steps is the safety: every check that can refuse happens BEFORE `confirm_purchase`, the one call that spends money; after it, a failure never undoes the purchase (the number is ours) and is
reported as a partial result so the caller can record it and tell the team.

  1. our wallet is above the floor (default Rs 1,000: never buy with less in it)        -> wallet_low
  2. the number is still for sale, found by its digits in the list of its type          -> number_taken
  3. its monthly rate is within the limit                                               -> rate_too_high
  4. lock it (a draft order; nothing is charged)                                        -> number_taken
  5. VoiceLink's own summary of the draft: exactly ONE number, NO channel, a total within the limit and
     covered by the wallet                                                              -> rate_too_high
  6. confirm the purchase (the order is paid from our wallet)
  7. give the number to our client with call recording as the expectation says (OFF unless VOICELINK_RECORDING_EXPECTED), then point it at our bot (inbound and outbound)

Every refusal is a closed word; no price, number or id is ever put in a message or a log line."""

# ruff: noqa: E501


from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from app.telephony.voicelink_api import (
    AvailableDid,
    VoicelinkApi,
    VoicelinkError,
    digits_with_country,
)

log = logging.getLogger("app.numbers.buyer")
TYPES = {"mobile": 2, "landline": 3}   # VoiceLink's DID type ids; the types that need an approval request (140/160 series) are never sold here


class PickerRefused(Exception):
    """A closed reason: `wallet_low`, `number_taken`, `rate_too_high`, `vendor_unavailable`, `not_configured`."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class BuyerSettings:
    client_id: int
    bot_id: int
    wallet_floor_inr: float = 1000.0
    max_total_inr: float = 500.0   # for ONE number, excluding GST: a limit, not a price (a mobile number is about Rs 300 a month)
    months: int = 1
    recording: bool = False   # VOICELINK_RECORDING_EXPECTED: a number is given over with recording ON, as the expectation says; else OFF


@dataclass(frozen=True)
class Bought:
    number: str                         # +91XXXXXXXXXX
    did_id: int
    order_number: str
    stage: Literal["bought", "mapped", "routed"]   # how far the set-up got: only "routed" is a number that works
    cost_inr: float                     # what we paid (for our audit; never shown to a customer)

    @property
    def complete(self) -> bool:
        return self.stage == "routed"


def find(api: VoicelinkApi, number: str, did_type: int) -> AvailableDid | None:
    """The number in the list for sale (searched by its digits)."""
    digits = digits_with_country(number)
    if digits is None:
        return None
    for row in api.available_dids(did_type=did_type, prefix=digits[-10:], per_page=20):
        if digits_with_country(row.number) == digits:
            return row
    return None


def buy(api: VoicelinkApi, settings: BuyerSettings, number: str, kind: str) -> Bought:
    did_type = TYPES.get(kind)
    if did_type is None:
        raise PickerRefused("number_taken")
    try:
        if api.wallet().balance < settings.wallet_floor_inr:
            raise PickerRefused("wallet_low")
        did = find(api, number, did_type)
        if did is None:
            raise PickerRefused("number_taken")
        if did.monthly_rate * settings.months > settings.max_total_inr:
            raise PickerRefused("rate_too_high")
        try:
            order = api.lock_did(did.did_id, settings.months)
        except VoicelinkError as exc:
            if exc.reason == "refused":
                raise PickerRefused("number_taken") from None
            raise
        summary = api.order_summary(order.order_id)
        if summary.did_count != 1 or summary.channel_count != 0 or summary.total > settings.max_total_inr or summary.wallet_balance - summary.total < 0:
            raise PickerRefused("rate_too_high")
        order_number = api.confirm_purchase(order.order_id)   # <- the money moves here
    except VoicelinkError as exc:
        log.warning("number_picker vendor_failed reason=%s", exc.reason)
        raise PickerRefused("vendor_unavailable") from None
    stage: Literal["bought", "mapped", "routed"] = "bought"
    try:
        api.map_did(client_id=settings.client_id, did_id=did.did_id, description="Stack19 customer number", recording=settings.recording)
        stage = "mapped"
        api.create_routing(did_id=did.did_id, bot_id=settings.bot_id)
        stage = "routed"
    except VoicelinkError as exc:   # the number is bought and ours: say how far it got; never raise (the caller records it and tells the team)
        log.warning("number_picker setup_incomplete stage=%s reason=%s", stage, exc.reason)
    return Bought(number=did.number, did_id=did.did_id, order_number=order_number, stage=stage, cost_inr=summary.total)
