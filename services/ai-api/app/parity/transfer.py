"""(e) Warm transfer to a human: "connect me to someone" rings the assigned staff member's phone and bridges the call; no answer (or outside their hours) creates a HOT-LEAD HAND-OFF instead. The bridge is a fake
until telephony exists. Pure."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

RING_SECONDS = 20


class Bridge(Protocol):
    def ring_and_bridge(self, phone: str, seconds: int) -> bool: ...


@dataclass(frozen=True)
class TransferOutcome:
    kind: str  # bridged | handoff
    reason: str  # connected | no_answer | no_staff | outside_hours


def transfer(staff_phone: str | None, within_staff_hours: bool, bridge: Bridge) -> TransferOutcome:
    if not staff_phone:
        return TransferOutcome("handoff", "no_staff")
    if not within_staff_hours:
        return TransferOutcome("handoff", "outside_hours")
    if bridge.ring_and_bridge(staff_phone, RING_SECONDS):
        return TransferOutcome("bridged", "connected")
    return TransferOutcome("handoff", "no_answer")
