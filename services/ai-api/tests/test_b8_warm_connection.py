"""B8 (a), 18 Nov 2026: the connection to the voice engine stays open between the turns of a call (httpx closes an idle connection after 5 seconds by default)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.conversation import engines


def test_the_voice_client_keeps_an_idle_connection_for_two_minutes(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}
    real = httpx.AsyncClient

    def spy(*args: Any, **kwargs: Any) -> httpx.AsyncClient:
        seen.update(kwargs)
        return real(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", spy)
    engines.real_engine_factory(cartesia_key="k", sarvam_key="s")
    limits = seen["limits"]
    assert limits.keepalive_expiry == engines.KEEPALIVE_SECONDS == 120.0 and limits.max_keepalive_connections >= 1
