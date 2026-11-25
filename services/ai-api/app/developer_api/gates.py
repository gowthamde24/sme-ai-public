"""The gates a call goes through before it is placed (pure: no I/O). They are the app's own rules, applied to the TEST sandbox: the lead must be on the workspace's sandbox list, have a number and
consent on file, not be on the Do-Not-Disturb list, the workspace's wallet must cover a call, and the call goes out inside the calling hours (outside them it waits for the next opening, as the
app's call-first rule does). In test mode the Do-Not-Disturb list is every number ending in 0000 and the simulated wallet is empty for every number ending in 9999 (docs/contracts/developer-api.md).
Nobody is dialled in test mode, whatever the gates say."""

# ruff: noqa: E501

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.developer_api import keys as K

CONCURRENT_CALLS = 10
CALLS_PER_MINUTE = 10


def is_empty_wallet_number(phone: str | None) -> bool:
    """Test mode's empty wallet: any number ending in 9999 (so a developer can test the 402)."""
    return bool(phone) and str(phone).endswith("9999")


@dataclass(frozen=True)
class Refusal:
    status: int
    code: str
    message: str
    retry_after: int | None = None


# the refusal each gate gives, in the order the gates run
_ROWS: dict[str, tuple[int, str, str]] = {
    "sandbox": (404, "not_found", "Not found."),
    "number": (422, "lead_has_no_number", "This lead has no phone number, so it cannot be called."),
    "consent": (422, "consent_required", "The lead must have agreed to be contacted (consent.given = true). We don't call or message without consent."),
    "dnd": (422, "number_on_dnd", "This number is on the Do-Not-Disturb list. We don't call it."),
    "wallet": (402, "wallet_empty", "The wallet cannot cover this call. Add money in the app and try again."),
}
REFUSALS: dict[str, Refusal] = {gate: Refusal(*row) for gate, row in _ROWS.items()}


@dataclass(frozen=True)
class Plan:
    gates: list[dict[str, Any]]
    refusal: Refusal | None
    starts_at: datetime
    starts: str   # "now" | "at_opening"
    blocked_by: str | None   # the code of the first gate that refuses, or of the capacity limit


def plan(lead: dict[str, Any] | None, active_calls: int, calls_last_minute: int, now: datetime) -> Plan:
    """Every gate is evaluated (a dry run shows them all); `refusal` is the first structural one. The capacity limits are reported here for a dry run but enforced by the database (so a replay of
    the same Idempotency-Key still returns its call)."""
    opening = K.next_opening(now)
    starts, starts_at = ("now", now) if opening <= now else ("at_opening", opening)
    phone = (lead or {}).get("phone")
    checks: list[tuple[str, bool]] = [
        ("sandbox", lead is not None),
        ("number", bool(phone)),
        ("consent", bool((lead or {}).get("consent_given"))),
        ("dnd", not K.is_dnd_test_number(phone)),
        ("wallet", not is_empty_wallet_number(phone)),
    ]
    gates: list[dict[str, Any]] = [{"gate": name, "ok": ok, "code": None if ok else REFUSALS[name].code} for name, ok in checks]
    gates.append({"gate": "capacity", "ok": active_calls < CONCURRENT_CALLS and calls_last_minute < CALLS_PER_MINUTE,
                  "code": None if active_calls < CONCURRENT_CALLS and calls_last_minute < CALLS_PER_MINUTE else ("too_many_calls" if active_calls >= CONCURRENT_CALLS else "rate_limited")})
    gates.append({"gate": "calling_hours", "ok": True, "code": None})   # never refuses: outside the hours the call waits for the next opening
    refusal = next((REFUSALS[g["gate"]] for g in gates if not g["ok"] and g["gate"] in REFUSALS), None)
    blocked = next((str(g["code"]) for g in gates if not g["ok"]), None)
    return Plan(gates=gates, refusal=refusal, starts_at=starts_at, starts=starts, blocked_by=blocked)
