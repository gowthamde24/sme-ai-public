"""Buying and giving back ONE channel (one more call at once) at the phone company, behind a port (26 Nov 2026; EXTRA_LINES). The workspace's entitlement is the database's (`extra_line_buy` charged the wallet and
recorded it); this port only makes the phone company's side true. Two providers:

  FakeChannels       buys nothing and calls nobody: staging and every test. It can be told to refuse, to prove the money goes back.
  VoicelinkChannels  the VoiceLink adapter, a SKELETON behind VOICELINK_CHANNEL_BUY (default OFF). It does the read-only checks the number buyer does (the wallet floor) and then stops at `not_built`: VoiceLink's channel
                     purchase is not in the API text we hold, so no endpoint is invented here. Nothing in a test or a run ever reaches a real purchase.

Every refusal is a closed word (`ChannelRefused.reason`); no price, id or account detail is put in a message or a log line."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from app.telephony.voicelink_api import VoicelinkApi, VoicelinkError

log = logging.getLogger("app.extra_lines.channel")


class ChannelRefused(Exception):
    """The channel could not be bought or given back. `reason`: switch_off, no_account, wallet_low, vendor_unavailable, not_built."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ChannelOrder:
    ref: str   # the phone company's order word, an opaque token (letters, digits and _ . : -, at most 60)


class ChannelProvider(Protocol):
    live: bool   # True only for a provider that really buys: when False the team is told to buy the channel by hand

    def buy(self, *, tenant_id: uuid.UUID, line_id: uuid.UUID, token: str) -> ChannelOrder: ...
    def release(self, *, tenant_id: uuid.UUID, line_id: uuid.UUID, ref: str | None, token: str) -> None: ...


@dataclass
class FakeChannels:
    live: bool = False
    refuse: str | None = None   # a test sets a reason to make every purchase fail
    bought: list[uuid.UUID] = field(default_factory=list)
    released: list[uuid.UUID] = field(default_factory=list)

    def buy(self, *, tenant_id: uuid.UUID, line_id: uuid.UUID, token: str) -> ChannelOrder:
        if self.refuse:
            raise ChannelRefused(self.refuse)
        if line_id not in self.bought:   # the same line twice is the same channel
            self.bought.append(line_id)
        return ChannelOrder(ref=f"fake-{line_id.hex[:16]}")

    def release(self, *, tenant_id: uuid.UUID, line_id: uuid.UUID, ref: str | None, token: str) -> None:
        if line_id not in self.released:
            self.released.append(line_id)


class VoicelinkChannels:
    """SKELETON (VOICELINK_CHANNEL_BUY, default OFF). Order of the steps, as the number buyer's (app/numbers/buyer.py): every check that can refuse comes BEFORE the one call that spends money.

      1. the switch is on                                              -> switch_off
      2. the workspace has its own VoiceLink client                    -> no_account
      3. our VoiceLink wallet is above the floor (read-only)           -> wallet_low
      4. the purchase of one channel for that client                   -> not_built   (TO BUILD from VoiceLink's API text: the endpoint and its summary check, as `order_summary` does for numbers:
                                                                          exactly ONE channel, no number, a total within the limit; UNVERIFIED until the first real purchase)
    Giving a channel back is the same: the endpoint is not known, so `release` refuses with `not_built` and the worker keeps the line in its list (the team gives it back by hand)."""

    live = True

    def __init__(self, api: VoicelinkApi, *, enabled: bool, client_for: Callable[[str, uuid.UUID], int | None], wallet_floor_inr: float = 1000.0) -> None:
        self._api, self._enabled, self._client_for, self._floor = api, enabled, client_for, wallet_floor_inr

    def buy(self, *, tenant_id: uuid.UUID, line_id: uuid.UUID, token: str) -> ChannelOrder:
        if not self._enabled:
            raise ChannelRefused("switch_off")
        client_id = self._client_for(token, tenant_id)
        if client_id is None:
            raise ChannelRefused("no_account")
        try:
            if self._api.wallet().balance < self._floor:
                raise ChannelRefused("wallet_low")
        except VoicelinkError as exc:
            log.warning("channel_buy vendor_failed reason=%s", exc.reason)
            raise ChannelRefused("vendor_unavailable") from None
        raise ChannelRefused("not_built")

    def release(self, *, tenant_id: uuid.UUID, line_id: uuid.UUID, ref: str | None, token: str) -> None:
        if not self._enabled:
            raise ChannelRefused("switch_off")
        raise ChannelRefused("not_built")
