"""The worker's notification pass (one per scheduler tick). It asks the database for the due messages (leased for 3 minutes; the database applies the rate limit and the collapse), builds each text from the closed
phrases and the fields the Owner allowed, sends it through the guarded client and tells the database the result; vendors.retry_delay decides "again in N seconds" or "failed". Once in ten minutes it asks the database to
queue the low-balance message for channels that asked for it, once an hour it clears the 30-day-old log. Nothing here logs an address, a token, a name, a number or a text: closed words and counts only. Runs only when NOTIFY_OUT=on and the
secret store exists."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from typing import Any

from app.connector_vault import ConnectorVault
from app.notify_out import messages, vendors
from app.notify_out.repository import NotifyRepository
from app.outbound_http import GuardedHttp
from app.tenancy.repository import TokenRejected

logger = logging.getLogger("app.notify_out.runner")

BATCH = 15
PACE_S = {"slack": 1.0, "telegram": 1.0, "teams": 0.3}   # Slack and Telegram ask for about one message a second
MAX_SLEEP_S = 20.0
SCAN_EVERY_S = 600.0
PURGE_EVERY_S = 3600.0


class NotifyRunner:
    def __init__(self, repo: NotifyRepository, vault: ConnectorVault, http: GuardedHttp | None = None, *, monotonic: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep, batch: int = BATCH) -> None:
        self._repo, self._vault, self._http = repo, vault, http or GuardedHttp()
        self._monotonic, self._sleep, self._batch = monotonic, sleep, batch
        self._scanned_at: float | None = None
        self._purged_at: float | None = None

    def __repr__(self) -> str:
        return "NotifyRunner(<vault>)"

    def _attempt(self, row: dict[str, Any]) -> vendors.SendOutcome:
        secret = self._vault.get(uuid.UUID(str(row["tenant_id"])), str(row["kind"]))
        if secret is None:
            return vendors.SendOutcome(False, "no_secret")
        text = messages.build_text(str(row["event"]), row.get("data"), str(row.get("language") or "en"), int(row.get("more") or 0))
        return vendors.send(self._http, str(row["kind"]), secret, text)

    def run(self, token: str) -> int:
        """One pass. Returns how many messages were tried. A refused token is raised (the worker signs in again); anything else is logged by class name."""
        self._scan_if_due(token)
        rows = self._repo.claim(token, self._batch)
        tried, slept = 0, 0.0
        last_sent: dict[str, float] = {}
        for row in rows:
            try:
                kind = str(row["kind"])
                channel = str(row["channel_id"])
                wait = PACE_S.get(kind, 1.0) - (self._monotonic() - last_sent[channel]) if channel in last_sent else 0.0
                if wait > 0 and slept + wait <= MAX_SLEEP_S:
                    self._sleep(wait)
                    slept += wait
                outcome = self._attempt(row)
                last_sent[channel] = self._monotonic()
                failures = int(row.get("attempts") or 0) + 1
                retry = None if outcome.ok else vendors.retry_delay(failures, outcome.reason or "rejected")
                if retry is not None and outcome.retry_after_s:
                    retry = max(retry, min(outcome.retry_after_s, 3600))
                self._repo.record(token, uuid.UUID(str(row["id"])), outcome.ok, outcome.reason, retry)
                logger.info("notify delivery: kind=%s event=%s ok=%s reason=%s", kind, str(row["event"]), outcome.ok, outcome.reason or "-")
                tried += 1
            except TokenRejected:
                raise
            except Exception as exc:   # noqa: BLE001 - one message never stops the others; its lease runs out and it is tried again
                logger.error("notify delivery crashed: %s", exc.__class__.__name__)
        self._purge_if_due(token)
        return tried

    def _scan_if_due(self, token: str) -> None:
        now = self._monotonic()
        if self._scanned_at is not None and now - self._scanned_at < SCAN_EVERY_S:
            return
        self._scanned_at = now
        try:
            self._repo.scan_low_balance(token)
        except TokenRejected:
            raise
        except Exception as exc:   # noqa: BLE001
            logger.error("notify low-balance scan failed: %s", exc.__class__.__name__)

    def _purge_if_due(self, token: str) -> None:
        now = self._monotonic()
        if self._purged_at is not None and now - self._purged_at < PURGE_EVERY_S:
            return
        self._purged_at = now
        try:
            self._repo.purge(token)
        except TokenRejected:
            raise
        except Exception as exc:   # noqa: BLE001
            logger.error("notify purge failed: %s", exc.__class__.__name__)
