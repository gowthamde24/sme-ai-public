"""Gold and silver price, for information (job BP, ADR 0078). Metals.dev (official API: GET https://api.metals.dev/v1/latest?api_key=…&currency=INR&unit=g, "a maximum delay of 60 seconds"). The figure is the
metal's international spot-based price in rupees per gram, NOT the jewellery, retail or IBJA rate, and NEVER a price in the owner's price list or a quote: it is shown as a reference, with its time and its
source, and the quote engine never reads it (non-negotiable 4). Cached in memory for 15 minutes so a busy shop does not spend the provider's free quota."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

import httpx

from app.agents.web import SearchError

logger = logging.getLogger("app.websearch.metals")
CACHE_SECONDS = 900


@dataclass(frozen=True)
class MetalQuote:
    gold_paise_per_gram: int
    silver_paise_per_gram: int
    as_of: datetime
    source: str


class MetalPrices(Protocol):
    def latest(self) -> MetalQuote: ...


def _paise(value: object) -> int:
    amount = Decimal(str(value))
    if amount <= 0 or amount > Decimal("10000000"):
        raise SearchError("bad_response")
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


class MetalsDev:
    def __init__(self, api_key: str, *, client: httpx.Client | None = None, base_url: str = "https://api.metals.dev", clock: Callable[[], float] = time.monotonic) -> None:
        self._key = api_key
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0))
        self._clock = clock
        self._cached: tuple[float, MetalQuote] | None = None

    def __repr__(self) -> str:
        return "MetalsDev(<key hidden>)"

    def latest(self) -> MetalQuote:
        if self._cached is not None and self._clock() - self._cached[0] < CACHE_SECONDS:
            return self._cached[1]
        try:
            response = self._client.get(f"{self._base}/v1/latest", params={"api_key": self._key, "currency": "INR", "unit": "g"})
        except httpx.TimeoutException:
            raise SearchError("timeout") from None
        except httpx.HTTPError as exc:
            logger.warning("metal prices unreachable: %s", exc.__class__.__name__)
            raise SearchError("unavailable") from None
        if response.status_code in (401, 403):
            raise SearchError("unauthorized")
        if response.status_code == 429:
            raise SearchError("rate_limited")
        if response.status_code >= 400:
            raise SearchError("unavailable")
        try:
            body = response.json()
            metals = body["metals"]
            stamp = str(body.get("timestamps", {}).get("metal", ""))
            if body.get("status") != "success" or body.get("currency") != "INR" or body.get("unit") != "g":
                raise SearchError("bad_response")
            quote = MetalQuote(_paise(metals["gold"]), _paise(metals["silver"]), datetime.fromisoformat(stamp.replace("Z", "+00:00")) if stamp else datetime.now(UTC), "Metals.dev")
        except (KeyError, TypeError, ValueError, ArithmeticError):
            raise SearchError("bad_response") from None
        self._cached = (self._clock(), quote)
        return quote


class FixtureMetals:
    def __init__(self, quote: MetalQuote | None = None) -> None:
        self._quote = quote or MetalQuote(1_450_000, 18_500, datetime(2026, 10, 5, 8, 30, tzinfo=UTC), "fixture")
        self.calls = 0

    def latest(self) -> MetalQuote:
        self.calls += 1
        return self._quote
