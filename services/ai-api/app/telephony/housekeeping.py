"""Close the calls nobody is on any more (owner, 9 Nov 2026: the live bar must never lie). Every scheduler tick, `public.phone_calls_close_orphans` marks as failed any call that is still "ringing" or
"in progress" but has said nothing for the call cap + 60 seconds (the phone server died, or the line dropped without a word), or is older than 15 minutes. A failure is logged by class name only
and never fails the tick (a refused token does, so the worker signs in again)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from collections.abc import Callable

from app.rpc_base import RpcClient
from app.tenancy.repository import TokenRejected

logger = logging.getLogger("app.telephony.housekeeping")
EXTRA_S = 60
MAX_CAP_S = 300   # the phone gate never allows a longer call (app/telephony/wiring.py)


def stale_seconds(call_cap_s: int) -> int:
    """The seconds of silence after which a call is over: the call cap + 60 s."""
    return max(1, min(int(call_cap_s), MAX_CAP_S)) + EXTRA_S


class OrphanCalls:
    def __init__(self, call: Callable[[str], int]) -> None:
        self._call = call

    @classmethod
    def over_rpc(cls, rest_url: str, anon_key: str, call_cap_s: int) -> OrphanCalls:
        rpc = RpcClient(rest_url, anon_key)
        seconds = max(60, stale_seconds(call_cap_s))
        return cls(lambda token: int(rpc.call(token, "phone_calls_close_orphans", {"p_stale_seconds": seconds}) or 0))

    def run(self, token: str) -> int | None:
        try:
            n = self._call(token)
        except TokenRejected:
            raise
        except Exception as exc:   # noqa: BLE001 - never fails the tick
            logger.error("closing orphaned calls failed: %s", exc.__class__.__name__)
            return None
        if n:
            logger.warning("orphaned calls closed: %d", n)   # (a number only)
        return n
