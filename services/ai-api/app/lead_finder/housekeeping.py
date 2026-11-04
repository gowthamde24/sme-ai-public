"""Google Maps terms in practice (ADR 0119): the scheduler blanks every Places field other than `place_id` that is older than 30 days (`public.prospect_places_expire`, scheduler account only).
At most once every six hours; a failure is logged by class name and never fails the scheduler's tick (a refused token does, so the worker signs in again)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import time
from collections.abc import Callable

from app.rpc_base import RpcClient
from app.tenancy.repository import TokenRejected

logger = logging.getLogger("app.lead_finder.housekeeping")
EVERY_SECONDS = 6 * 3600
MAX_AGE_DAYS = 30


class PlacesExpiry:
    def __init__(self, call: Callable[[str], int], *, every_seconds: int = EVERY_SECONDS, monotonic: Callable[[], float] = time.monotonic) -> None:
        self._call = call
        self._every = every_seconds
        self._monotonic = monotonic
        self._last: float | None = None

    @classmethod
    def over_rpc(cls, rest_url: str, anon_key: str) -> PlacesExpiry:
        rpc = RpcClient(rest_url, anon_key)
        return cls(lambda token: int(rpc.call(token, "prospect_places_expire", {"p_max_age_days": MAX_AGE_DAYS}) or 0))

    def run_if_due(self, token: str) -> int | None:
        now = self._monotonic()
        if self._last is not None and now - self._last < self._every:
            return None
        self._last = now
        try:
            n = self._call(token)
        except TokenRejected:
            raise
        except Exception as exc:   # never fails the tick
            logger.error("lead finder places expiry failed: %s", exc.__class__.__name__)
            return None
        if n:
            logger.info("lead finder: Google Maps details expired on %d prospects", n)
        return n
