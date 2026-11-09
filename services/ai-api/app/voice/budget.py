"""Our own spending cap on the primary voice, Cartesia (owner, 6 Nov 2026: overages are on and Cartesia has no cap of its own).

A call reserves its allowance when it is admitted (at most PER_CALL characters, at most what is left of the day's limit), speaks with Sarvam Bulbul once the allowance is spent, and gives
back what it did not use when it ends. The numbers and the count live in the database (migration 20261231280000), so every copy of the API shares one day's limit.

Fail closed: if the reservation cannot be made (the database is unreachable, the principal cannot sign in), the call gets 0 characters and speaks with Sarvam. Never silent, never over the cap."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

log = logging.getLogger("app.voice.budget")

ENGINE = "cartesia"
PER_CALL = 2000   # the most one call may ask for (the database applies its own per-call limit as well)


@dataclass(frozen=True)
class Hold:
    id: uuid.UUID | None   # None: nothing was reserved (nothing to give back)
    granted: int
    day_used: int | None = None
    day_limit: int | None = None


class VoiceBudget(Protocol):
    def reserve(self, want: int, source: str) -> Hold: ...
    def release(self, hold: Hold, used: int) -> dict[str, Any] | None: ...


class RpcLike(Protocol):
    def call(self, token: str, function: str, args: dict[str, Any]) -> Any: ...


class RpcVoiceBudget:
    def __init__(self, rpc: RpcLike, token: Callable[[], str]) -> None:
        self._rpc, self._token = rpc, token

    def reserve(self, want: int, source: str) -> Hold:
        try:
            out = self._rpc.call(self._token(), "voice_budget_reserve", {"p_engine": ENGINE, "p_want": max(0, int(want)), "p_source": source})
            hold = Hold(uuid.UUID(str(out["hold"])), int(out["granted"]), int(out["day_used"]), int(out["day_limit"]))
        except Exception as exc:  # noqa: BLE001 - fail closed: no reservation, no Cartesia (the call speaks with Sarvam)
            log.warning("voice_budget_reserve_failed %s", exc.__class__.__name__)
            return Hold(None, 0)
        log.info("voice_budget_reserved source=%s granted=%d day_used=%d day_limit=%d", source, hold.granted, hold.day_used or 0, hold.day_limit or 0)
        return hold

    def release(self, hold: Hold, used: int) -> dict[str, Any] | None:
        if hold.id is None:
            return None
        try:
            out = self._rpc.call(self._token(), "voice_budget_release", {"p_hold": str(hold.id), "p_used": max(0, int(used))})
        except Exception as exc:  # noqa: BLE001 - not given back: the day counts the whole reservation as spent (the safe side)
            log.warning("voice_budget_release_failed %s", exc.__class__.__name__)
            return None
        result: dict[str, Any] = out if isinstance(out, dict) else {}
        log.info("voice_budget_released used=%s granted=%s day_used=%s", result.get("used"), result.get("granted"), result.get("day_used"))
        return result


class FixedBudget:
    """Tests and local runs: a day's allowance in memory."""

    def __init__(self, day_chars: int, per_call: int = PER_CALL) -> None:
        self.day_chars, self.per_call, self.used = day_chars, per_call, 0
        self.released: list[tuple[int, int]] = []   # (granted, used)

    def reserve(self, want: int, source: str) -> Hold:
        granted = max(0, min(want, self.per_call, self.day_chars - self.used))
        self.used += granted
        return Hold(uuid.uuid4(), granted, self.used, self.day_chars)

    def release(self, hold: Hold, used: int) -> dict[str, Any] | None:
        used = max(0, min(used, hold.granted))
        self.used -= hold.granted - used
        self.released.append((hold.granted, used))
        return {"used": used, "granted": hold.granted, "day_used": self.used}
