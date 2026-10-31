"""The deployment's telephony switches as the gate reads them (job phone-calls part 1)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from app.connectors.phone import normalise
from app.telephony.gate import Mode, Settings


def gate_settings(settings: Any) -> Settings:
    """From the app settings. Anything but the three known modes is `off`; a sandbox number that is not a number is ignored (it can never be rung)."""
    mode: Mode = settings.telephony_mode if settings.telephony_mode in ("off", "sandbox", "live") else "off"
    numbers = frozenset(n for n in (normalise(part) for part in str(settings.telephony_sandbox_numbers).split(",")) if n)
    return Settings(mode=mode, live_confirmed=bool(settings.telephony_live_confirmed), sandbox_numbers=numbers, max_concurrent=max(1, int(settings.telephony_max_concurrent)))
