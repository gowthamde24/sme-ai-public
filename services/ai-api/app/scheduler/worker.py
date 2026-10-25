"""The scheduler's worker process (job AW, ADR 0068): `python -m app.scheduler.worker`, `make dev-worker-local`. One process, one thread, no queue, no new account: every `interval` seconds (default 60)
it signs in as its registered principal if it must and runs one tick (tick.py). A tick that fails for any reason is logged by its class name and the next one runs on time; the process only stops when told
to (Ctrl-C, SIGTERM) or when it is started wrongly. Two workers at once are safe: the database hands each message and each reminder to exactly one of them (row locks, SKIP LOCKED, a lease, a record
per reminder).

Safe by default: the worker does nothing unless the database lists a business, which it does only while the GLOBAL outbox switch AND that business's automatic sending are on. With the local fake
channel nothing ever leaves this machine."""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
import time
from collections.abc import Callable
from typing import Protocol

import httpx

from app.billing.mail import (
    BillingReminders,
    EmailSender,
    PendingReminders,
    PostgrestBillingMailRepository,
    build_sender,
)
from app.billing.provider import BillingProvider, build_provider
from app.billing.repository import PostgrestBillingRepository
from app.billing.service import BillingService
from app.catalogue.storage import HttpStorageClient, StorageClient
from app.config import ConfigurationError, Settings, build_auth_config
from app.notifications.repository import PostgrestNotificationsRepository
from app.notifications.runner import PushRunner
from app.notifications.webpush import WebPushSender
from app.notifications.wiring import build_vapid
from app.outbox.adapter import ChannelAdapter, build_adapter
from app.outbox.service import media_signer
from app.outbox.voice_hook import VoiceNotes
from app.privacy.housekeeping import Housekeeping
from app.privacy.repository import PostgrestPrivacyRepository
from app.scheduler.repository import PostgrestSchedulerRepository, SchedulerRepository
from app.scheduler.session import PrincipalSession, SignInError
from app.scheduler.tick import TickResult, run_tick
from app.tenancy.repository import TokenRejected
from app.voice.factory import build_note_voice

logger = logging.getLogger("app.scheduler.worker")

MIN_INTERVAL = 5
MAX_INTERVAL = 3600


class TokenSource(Protocol):
    """What the worker needs from its sign-in: a token that is good now, and a way to say it was refused."""

    def token(self) -> str: ...
    def invalidate(self) -> None: ...


class Worker:
    def __init__(
        self,
        repository: SchedulerRepository,
        adapter: ChannelAdapter,
        session: TokenSource,
        *,
        interval_seconds: int = 60,
        monotonic: Callable[[], float] = time.monotonic,
        storage: StorageClient | None = None,
        housekeeping: Housekeeping | None = None,
        push: PushRunner | None = None,
        voice: VoiceNotes | None = None,
        billing_mail: BillingReminders | None = None,
        billing_clocks: BillingService | None = None,
        billing_pending_mail: PendingReminders | None = None,
    ) -> None:
        if not MIN_INTERVAL <= interval_seconds <= MAX_INTERVAL:
            raise ValueError("the interval must be between 5 and 3600 seconds")
        self._repository = repository
        self._adapter = adapter
        self._session = session
        self.interval_seconds = interval_seconds
        self._monotonic = monotonic
        # the worker signs the photos of a message it has CLAIMED with its own token: the database lets the registered worker read exactly those files (job BB), and no service key exists
        self._sign_media = media_signer(storage)
        self._housekeeping = housekeeping
        self._push = push
        # job CV: the spoken copy of a campaign message, made at send time by the text-to-speech provider (None = voice notes are not available in this process)
        self._voice = voice
        # job DI: the e-mails of a workspace that went read-only (day 1, 30, 60, 83); the FAKE sender sends nothing; only while the platform's billing switch is on
        self._billing_mail = billing_mail
        # job DM: the trial is 14 days from the day WhatsApp is connected; the provider is told the day the trial ends once it is known
        self._billing_clocks = billing_clocks
        # job DM: the reminder e-mails to a workspace still waiting for WhatsApp (fake sender)
        self._billing_pending_mail = billing_pending_mail

    def tick_once(self) -> TickResult | None:
        """One tick. Never raises: a failed tick is logged (by class name only) and answered with None."""
        try:
            token = self._session.token()
            result = run_tick(
                self._repository,
                self._adapter,
                token,
                interval_seconds=self.interval_seconds,
                sign_media=self._sign_media,
                voice=self._voice.clip_for if self._voice is not None else None,
            )
            self._privacy_housekeeping(token)
            self._push_to_the_team(token)
            self._billing_reminders(token)
            self._billing_trial_clocks(token)
            return result
        except TokenRejected:
            logger.error("scheduler: the data layer refused the token; signing in again")
            self._session.invalidate()
        except SignInError as exc:
            logger.error("scheduler: %s", exc)
        except Exception as exc:  # a crashed tick must not stop the next one
            logger.error("scheduler tick crashed: %s", exc.__class__.__name__)
        return None

    def _privacy_housekeeping(self, token: str) -> None:
        """Job BN: deletions whose cooling-off ended, expired export files, the retention clean-up. Independent of the outbox switches; a failure here never fails the tick (a refused token does, so we sign in again)."""
        if self._housekeeping is None:
            return
        try:
            self._housekeeping.run_if_due(token)
        except TokenRejected:
            raise
        except Exception as exc:
            logger.error("privacy housekeeping crashed: %s", exc.__class__.__name__)

    def _push_to_the_team(self, token: str) -> None:
        """Job BY: tell opted-in members what newly waits for them (web-push; off unless VAPID keys are set). Independent of the outbox switches; a failure here never fails the tick."""
        if self._push is None:
            return
        try:
            self._push.run(token)
        except TokenRejected:
            raise
        except Exception as exc:
            logger.error("push pass crashed: %s", exc.__class__.__name__)

    def _billing_reminders(self, token: str) -> None:
        if self._billing_mail is None:
            return
        try:
            self._billing_mail.run(token)
            if self._billing_pending_mail is not None:
                self._billing_pending_mail.run(token)
        except TokenRejected:
            raise
        except Exception as exc:
            logger.error("billing reminders crashed: %s", exc.__class__.__name__)

    def _billing_trial_clocks(self, token: str) -> None:
        if self._billing_clocks is None:
            return
        try:
            self._billing_clocks.sync_trial_clocks(token)
        except TokenRejected:
            raise
        except Exception as exc:
            logger.error("billing trial clocks crashed: %s", exc.__class__.__name__)

    def run_forever(self, stop: threading.Event) -> None:
        """Tick, then wait for the next deadline (not `interval` after the tick ended: a slow tick does not push the schedule back). Returns when `stop` is set."""
        deadline = self._monotonic()
        while not stop.is_set():
            self.tick_once()
            deadline += self.interval_seconds
            wait = deadline - self._monotonic()
            if (
                wait < 0
            ):  # the tick overran its slot: start the next one now and keep going from here
                deadline = self._monotonic()
                wait = 0
            stop.wait(wait)


def _billing_sender(settings: Settings) -> EmailSender:
    try:
        return build_sender(settings.billing_email_sender)
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None


def _billing_provider(settings: Settings) -> BillingProvider:
    try:
        return build_provider(settings.billing_provider)
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None


def build_worker(settings: Settings) -> Worker:
    """Wire the worker from settings, or raise ConfigurationError (the process then refuses to start)."""
    problems: list[str] = []
    if not settings.scheduler_email:
        problems.append("SCHEDULER_EMAIL is required (the scheduler's registered account)")
    if settings.scheduler_password is None or not settings.scheduler_password.get_secret_value():
        problems.append("SCHEDULER_PASSWORD is required")
    if not MIN_INTERVAL <= settings.scheduler_interval_seconds <= MAX_INTERVAL:
        problems.append("SCHEDULER_INTERVAL_SECONDS must be between 5 and 3600")
    if problems:
        raise ConfigurationError("invalid scheduler configuration: " + "; ".join(problems))
    config = build_auth_config(settings)
    try:
        adapter = build_adapter(settings.outbox_adapter, settings)
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None
    assert settings.scheduler_email is not None and settings.scheduler_password is not None  # noqa: S101
    session = PrincipalSession(
        f"{config.supabase_url}/auth/v1",
        config.anon_key,
        settings.scheduler_email,
        settings.scheduler_password.get_secret_value(),
        client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)),
    )
    storage = HttpStorageClient(f"{config.supabase_url}/storage/v1", config.anon_key)
    vapid = build_vapid(settings)
    repository = PostgrestSchedulerRepository(config.rest_url, config.anon_key)
    return Worker(
        repository,
        adapter,
        session,
        interval_seconds=settings.scheduler_interval_seconds,
        billing_mail=BillingReminders(PostgrestBillingMailRepository(config.rest_url, config.anon_key), _billing_sender(settings)),
        billing_pending_mail=PendingReminders(PostgrestBillingMailRepository(config.rest_url, config.anon_key), _billing_sender(settings)),
        billing_clocks=BillingService(PostgrestBillingRepository(config.rest_url, config.anon_key), _billing_provider(settings)),
        storage=storage,
        housekeeping=Housekeeping(PostgrestPrivacyRepository(config.rest_url, config.anon_key), storage),
        push=PushRunner(PostgrestNotificationsRepository(config.rest_url, config.anon_key), WebPushSender(vapid)) if vapid is not None else None,
        voice=VoiceNotes(repository, *build_note_voice(settings)),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.scheduler.worker", description=__doc__)
    parser.add_argument("--once", action="store_true", help="run one tick and exit")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)  # its request lines are noise here
    try:
        worker = build_worker(Settings())
    except ConfigurationError as exc:
        print(f"scheduler: {exc}", file=sys.stderr)  # noqa: T201
        return 2
    if args.once:
        return 0 if worker.tick_once() is not None else 1
    stop = threading.Event()

    def _stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    logger.info("scheduler started: one tick every %d seconds", worker.interval_seconds)
    worker.run_forever(stop)
    logger.info("scheduler stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
