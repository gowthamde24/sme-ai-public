"""One tick of the scheduler (job AW, ADR 0068): for every business the database lists (both switches on), queue the visit reminders that are due, hand the approved CAMPAIGN steps that are due to the outbox
(job CP, ADR 0086), release the messages that are due through the outbox's own dispatch loop, and mark the visits that were not shown up for (a setting, off by default). Then tell the database what happened: counts only.

The database decides EVERYTHING about time and about whether to act: this module has no clock, no policy and no switch of its own. It asks, it carries out what it is handed, and it reports. A phase that
fails is counted and the next phase still runs; a business that fails does not stop the others; a tick that fails does not stop the next one (worker.py).

Reminder words are the fixed templates of the visit messages (app.visits.texts): the same visit gives the same words; a language no native reader has checked is submitted `uncertain`, which
makes the outbox hold it for a person. Counts, never words, phone numbers or names, are logged."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.outbox.adapter import ChannelAdapter
from app.outbox.service import DISPATCH_BATCH, MediaSigner, dispatch_due
from app.scheduler.repository import SchedulerRepository
from app.tenancy.repository import TokenRejected
from app.visits import texts

logger = logging.getLogger("app.scheduler.tick")

KINDS = ("evening_before", "heads_up")
# a tick hands over at most this many batches of messages per business (a backlog is finished by the next tick)
MAX_BATCHES = 5


@dataclass
class Tally:
    sent: int = 0
    failed: int = 0
    reminders: int = 0
    no_shows: int = 0
    errors: int = 0
    # campaign steps handed to the outbox (queued, held for a person or blocked by a per-message rule): reported with the reminders, which they are
    campaign_steps: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "sent": self.sent,
            "failed": self.failed,
            "reminders": self.reminders + self.campaign_steps,
            "no_shows": self.no_shows,
            "errors": self.errors,
        }

    def add(self, other: Tally) -> None:
        self.sent += other.sent
        self.failed += other.failed
        self.reminders += other.reminders
        self.campaign_steps += other.campaign_steps
        self.no_shows += other.no_shows
        self.errors += other.errors

    def idle(self) -> bool:
        return not any(self.as_dict().values())


@dataclass
class TickResult:
    tenants: int = 0
    tally: Tally = field(default_factory=Tally)

    def line(self) -> str:
        t = self.tally
        return (
            f"scheduler tick: tenants={self.tenants} sent={t.sent} failed={t.failed} "
            f"reminders={t.reminders} no_shows={t.no_shows} errors={t.errors}"
        )


def reminder_message_id(
    visit_id: uuid.UUID, kind: str, starts_at: datetime, language: str
) -> uuid.UUID:
    """The same reminder of the same visit time in the same language is the same message: every worker that asks makes the SAME id, so the database sees one request however many ask."""
    return uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"sme-ai-visit-auto-reminder:{visit_id}:{kind}:{starts_at.isoformat()}:{language}",
    )


def _queue_reminders(
    repository: SchedulerRepository, token: str, tenant_id: uuid.UUID, tally: Tally
) -> None:
    for item in repository.due_reminders(token, tenant_id):
        try:
            visit_id = uuid.UUID(str(item["visit_id"]))
            kind = str(item["kind"])
            starts_at = datetime.fromisoformat(str(item["starts_at"]).replace("Z", "+00:00"))
            if kind not in KINDS or starts_at.tzinfo is None:
                raise ValueError("unexpected reminder")
            language = str(item.get("language") or "en")
            if language not in texts.TEMPLATES:
                language = "en"
            answer = repository.queue_reminder(
                token,
                {
                    "p_tenant_id": str(tenant_id),
                    "p_visit_id": str(visit_id),
                    "p_kind": kind,
                    "p_message_id": str(reminder_message_id(visit_id, kind, starts_at, language)),
                    "p_body": texts.render("reminder", language, starts_at),
                    "p_language": language,
                    "p_uncertain": not texts.is_checked(language),
                },
            )
        except TokenRejected:
            raise
        except Exception as exc:  # one odd visit must not hold back the others
            tally.errors += 1
            logger.error("scheduler reminder failed: %s", exc.__class__.__name__)
            continue
        if answer.get("status") == "queued":
            tally.reminders += 1


def _campaigns(repository: SchedulerRepository, token: str, tenant_id: uuid.UUID, tally: Tally) -> None:
    """The campaign steps that are due, then the call list. The database does it all in one call (and nothing here knows a name, an amount or a word): it answers with counts."""
    done = repository.campaign_run(token, tenant_id)
    tally.campaign_steps += done["queued"] + done["held"] + done["blocked"]
    tally.errors += done["errors"]


def _release(
    repository: SchedulerRepository,
    adapter: ChannelAdapter,
    token: str,
    tenant_id: uuid.UUID,
    tally: Tally,
    sign_media: MediaSigner | None = None,
) -> None:
    for _ in range(MAX_BATCHES):
        done = dispatch_due(
            repository, adapter, token, tenant_id, limit=DISPATCH_BATCH, sign_media=sign_media
        )
        tally.sent += done.sent
        tally.failed += done.failed
        tally.errors += (
            done.retry_later
        )  # a message whose photos could not be signed this time: offered again by a later tick
        if done.sent + done.failed + done.retry_later < DISPATCH_BATCH:
            break


def _no_shows(
    repository: SchedulerRepository, token: str, tenant_id: uuid.UUID, tally: Tally
) -> None:
    tally.no_shows += repository.mark_no_shows(token, tenant_id)


def run_tenant(
    repository: SchedulerRepository,
    adapter: ChannelAdapter,
    token: str,
    tenant_id: uuid.UUID,
    sign_media: MediaSigner | None = None,
) -> Tally:
    """The four phases for one business, each on its own: a failure in one is counted and the others still run. A refused token ends the tick (the worker signs in again)."""
    tally = Tally()
    phases: tuple[tuple[str, Any], ...] = (
        ("reminders", lambda: _queue_reminders(repository, token, tenant_id, tally)),
        ("campaigns", lambda: _campaigns(repository, token, tenant_id, tally)),
        ("release", lambda: _release(repository, adapter, token, tenant_id, tally, sign_media)),
        ("no_shows", lambda: _no_shows(repository, token, tenant_id, tally)),
    )
    for name, phase in phases:
        try:
            phase()
        except TokenRejected:
            raise
        except Exception as exc:
            tally.errors += 1
            logger.error("scheduler phase %s failed: %s", name, exc.__class__.__name__)
    return tally


def run_tick(
    repository: SchedulerRepository,
    adapter: ChannelAdapter,
    token: str,
    *,
    interval_seconds: int,
    sign_media: MediaSigner | None = None,
) -> TickResult:
    """One pass over every business the database lists. Returns what was done (also reported to the database). Raises only TokenRejected."""
    result = TickResult()
    try:
        tenants = repository.tenants(token)
    except TokenRejected:
        raise
    except Exception as exc:
        tenants = []
        result.tally.errors += 1
        logger.error("scheduler could not list the businesses: %s", exc.__class__.__name__)
    result.tenants = len(tenants)
    for tenant_id in tenants:
        tally = run_tenant(repository, adapter, token, tenant_id, sign_media)
        try:
            repository.record(token, tenant_id, tally.as_dict())
        except TokenRejected:
            raise
        except Exception as exc:
            tally.errors += 1
            logger.error("scheduler could not record its tick: %s", exc.__class__.__name__)
        result.tally.add(tally)
    try:
        repository.heartbeat(token, interval_seconds, result.tally.errors)
    except TokenRejected:
        raise
    except Exception as exc:
        logger.error("scheduler could not beat its heart: %s", exc.__class__.__name__)
    logger.info(result.line())
    return result
