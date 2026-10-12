"""A web call is a metered call (job BP, ADR 0078): it is counted against the workspace's daily limit for its kind, reserved on the AI ledger BEFORE it is made and settled after (a call that provably never
reached a provider releases its reservation), exactly as voice is. The accounting models and their token prices are in migration 20261119090000."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol, TypeVar

from app.agents.llm.interface import Usage
from app.agents.web import FetchError, SearchError

T = TypeVar("T")

MICROS_PER_TOKEN = 1000
TOKENS = {"web-search": 600, "web-page": 50, "places-search": 3000, "metal-price": 100}
# a search provider's refusal that proves nothing was billed: release the reservation with the reason the ledger knows
_SEARCH_RELEASE = {"unauthorized": "not_configured", "rate_limited": "rate_limited", "quota": "rejected"}
# a fetch refused before any network call
_FETCH_RELEASE = frozenset({"bad_url", "bad_scheme", "bad_port", "userinfo", "bad_host", "ip_literal", "blocked_name", "off_host", "robots_disallowed", "daily_limit", "rate_limited"})


class Ledger(Protocol):
    def web_quota_take(self, model: str) -> None: ...
    def reserve_cost(self, step_key: str, *, model: str, max_input_tokens: int, max_output_tokens: int) -> None: ...
    def record_usage(self, step_key: str, usage: Usage) -> None: ...
    def release_cost(self, step_key: str, *, reason: str) -> None: ...


def metered(db: Ledger, model: str, step_key: str, call: Callable[[], T]) -> T:
    """The daily limit first, then the reservation (both raise the data layer's own refusal), then the call, then the settlement."""
    tokens = TOKENS[model]
    db.web_quota_take(model)
    db.reserve_cost(step_key, model=model, max_input_tokens=tokens, max_output_tokens=0)
    try:
        result = call()
    except SearchError as exc:
        reason = _SEARCH_RELEASE.get(exc.code)
        if reason is not None:
            db.release_cost(step_key, reason=reason)
        else:
            db.record_usage(step_key, Usage(tokens, 0, tokens * MICROS_PER_TOKEN))
        raise
    except FetchError as exc:
        if exc.code in _FETCH_RELEASE:
            db.release_cost(step_key, reason="rejected")
        else:
            db.record_usage(step_key, Usage(tokens, 0, tokens * MICROS_PER_TOKEN))
        raise
    db.record_usage(step_key, Usage(tokens, 0, tokens * MICROS_PER_TOKEN))
    return result
