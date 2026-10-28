"""(h) Number management: the business number plus extra channels (concurrency) and pools with rotation that skip a number flagged as spam. A provider interface with a fake; nothing is bought or dialled. Pure."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Number:
    e164: str
    spam_flagged: bool = False
    calls_today: int = 0


@dataclass
class NumberPool:
    """Rotation: the number with the fewest calls today that is not flagged; a per-number daily ceiling keeps one number from being burned."""

    numbers: list[Number] = field(default_factory=list)
    daily_ceiling: int = 150
    channels: int = 2  # how many calls may run at once (the business number plus extra channels)
    active_calls: int = 0

    def pick(self) -> Number | None:
        ok = [n for n in self.numbers if not n.spam_flagged and n.calls_today < self.daily_ceiling]
        return min(ok, key=lambda n: (n.calls_today, n.e164)) if ok else None

    def start_call(self) -> Number | None:
        if self.active_calls >= self.channels:
            return None  # queued: concurrency is full
        number = self.pick()
        if number is None:
            return None
        number.calls_today += 1
        self.active_calls += 1
        return number

    def end_call(self) -> None:
        self.active_calls = max(0, self.active_calls - 1)

    def flag_spam(self, e164: str) -> None:
        for n in self.numbers:
            if n.e164 == e164:
                n.spam_flagged = True
