"""(f) What happened to a dial attempt (voicemail, no answer, busy, switched off) and when to try again: the retry rules are the Owner's (Settings > Calls: count and gap per result). Pure."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class Signals:
    sip_code: int | None = None  # 486 busy, 480/503 unavailable, 404 unknown number
    ring_seconds: int = 0
    answered: bool = False
    machine_detected: bool = False  # the answering machine or voicemail greeting was heard


def classify_call_result(s: Signals) -> str:
    if s.answered and s.machine_detected:
        return "voicemail"
    if s.answered:
        return "answered"
    if s.sip_code == 486:
        return "busy"
    if s.sip_code in (480, 503):
        return "switched_off"
    if s.sip_code == 404:
        return "wrong_number"
    return "no_answer"


@dataclass(frozen=True)
class Retry:
    count: int
    gap_minutes: int


def next_attempt(result: str, attempts_so_far: int, rules: dict[str, Retry], now: datetime) -> datetime | None:
    """When to dial again, or None (no rule, the rule's count is used up, or the number is wrong). The calling-hours and DND rules still apply at dial time."""
    if result in ("answered", "wrong_number", "voicemail") and result not in rules:
        return None
    rule = rules.get({"switched_off": "no_answer"}.get(result, result))
    if rule is None or attempts_so_far >= rule.count:
        return None
    return now + timedelta(minutes=rule.gap_minutes)
