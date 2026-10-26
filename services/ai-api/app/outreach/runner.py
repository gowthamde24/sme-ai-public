"""The worker's outreach step (job DR A3): find the leads a standing rule must reach, take what is due, dial it, tell the database what happened, remind whoever has not called a hot lead back. Carried out with the scheduler
account's token; the database decides everything (hours, caps, consent, the day's limits) and hands out only what may be done NOW. WhatsApp steps are sent by the database through the one outbox (they wait there for the
channel); only the calls pass through here.

No telephony exists yet: the only dialer is the FAKE one, a table of answers by the last digit of the number, and it exists only when OUTREACH_DIALER=fake (staging, local). Without a dialer the worker does not take calls
out of the queue at all (they wait), but it still finds new leads and sends the reminders. Counts only are logged: no name, no number, no word of a conversation."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.outreach.repository import OutreachRepository
from app.tenancy.repository import RepositoryError, TokenRejected

logger = logging.getLogger("app.outreach.runner")

SCAN_LIMIT = 200
RUN_LIMIT = 50
REMINDER_LIMIT = 50


@dataclass(frozen=True)
class DialResult:
    result: str   # no_answer | busy | voicemail | connected | failed
    minutes: float = 0.0
    outcome: dict[str, Any] | None = None
    stop: bool = False


class Dialer(Protocol):
    def dial(self, call: dict[str, Any]) -> DialResult: ...


class FakeDialer:
    """Answers by the last digit of the number, so a demo and a test can predict each call. Nothing is dialled."""

    def __init__(self, *, clock: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._clock = clock
        self.dialled: list[str] = []

    def dial(self, call: dict[str, Any]) -> DialResult:
        digits = "".join(ch for ch in str(call.get("phone") or "") if ch.isdigit())
        self.dialled.append(str(call.get("item_id")))
        last = int(digits[-1]) if digits else 0
        if last <= 1:
            return DialResult("no_answer", 0.3)
        if last == 2:
            return DialResult("busy", 0.1)
        if last == 3:
            return DialResult("voicemail", 0.4)
        if last <= 5:
            return DialResult("connected", 1.5, {"outcome": "negative", "category": "not_interested", "reason": "Not looking right now"})
        if last <= 7:
            return DialResult("connected", 3.0, {"outcome": "positive", "category": "interested", "captured": {"budget": "50 lakh", "area": "Gachibowli"}})
        if last == 8:
            return DialResult("connected", 1.0, {"outcome": "unclear", "category": "call_back_later", "callback_at": (self._clock() + timedelta(days=1)).isoformat()})
        return DialResult("connected", 0.5, {"outcome": "negative", "category": "wrong_number"}, stop=True)


@dataclass
class OutreachTally:
    found: int = 0
    calls: int = 0
    failed: int = 0
    whatsapp: int = 0
    paused: int = 0
    reminded: int = 0
    notes: list[str] = field(default_factory=list)

    def idle(self) -> bool:
        return not (self.found or self.calls or self.failed or self.whatsapp or self.paused or self.reminded)


class OutreachRunner:
    def __init__(self, repository: OutreachRepository, dialer: Dialer | None = None) -> None:
        self._repo = repository
        self._dialer = dialer

    def run(self, token: str) -> OutreachTally:
        tally = OutreachTally()
        scan = self._repo.scan(token, SCAN_LIMIT)
        tally.found = int(scan.get("added") or 0)
        if self._dialer is not None:
            work = self._repo.run(token, RUN_LIMIT)
            tally.whatsapp = int(work.get("whatsapp") or 0)
            tally.paused = int(work.get("paused") or 0)
            for call in work.get("calls") or []:
                self._one_call(token, call, tally)
        tally.reminded = len(self._repo.reminders(token, REMINDER_LIMIT))
        if not tally.idle():
            logger.info("outreach: %s found, %s calls (%s failed), %s WhatsApp, %s paused, %s reminders", tally.found, tally.calls, tally.failed, tally.whatsapp, tally.paused, tally.reminded)
        return tally

    def _one_call(self, token: str, call: dict[str, Any], tally: OutreachTally) -> None:
        assert self._dialer is not None  # noqa: S101
        try:
            answer = self._dialer.dial(call)
        except Exception as exc:   # a dialer that failed is a failed call, which the database counts and retries
            logger.error("outreach: the dialer failed (%s)", exc.__class__.__name__)
            answer = DialResult("failed")
        try:
            self._repo.result(token, uuid.UUID(str(call["tenant_id"])), uuid.UUID(str(call["item_id"])), answer.result, answer.outcome, answer.minutes, answer.stop)
        except TokenRejected:
            raise
        except RepositoryError as exc:
            tally.failed += 1
            logger.error("outreach: a result was not accepted (%s)", exc.__class__.__name__)
            return
        tally.calls += 1
        if answer.result == "failed":
            tally.failed += 1
