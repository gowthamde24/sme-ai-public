"""One place that turns an HTTP failure into a constant code (job BD). The provider's text, address and key never leave this function."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import httpx

from app.voice.interface import VoiceError


def call(client: httpx.Client, method: str, url: str, **kw: Any) -> Any:
    """Send one request; return the decoded JSON body. Raises VoiceError with a constant code."""
    try:
        response = client.request(method, url, **kw)
    except httpx.TimeoutException:
        raise VoiceError("timeout") from None
    except httpx.HTTPError as exc:
        raise VoiceError(f"unreachable:{exc.__class__.__name__}") from None
    if not response.is_success:
        raise VoiceError(f"http_{response.status_code}")
    try:
        return response.json()
    except ValueError:
        raise VoiceError("bad_response") from None
