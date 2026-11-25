"""The worker's webhook pass (one per scheduler tick). It asks the database for the due deliveries (leased for 3 minutes), builds the signed body, sends it through the guarded sender and tells the
database the result; the retry schedule (retry.py) decides "again in N seconds" or "dead letter". A crash in one delivery leaves its lease to run out (it is tried again, not counted). Nothing here logs
an address, a body or a secret. Runs only when WEBHOOKS_OUT=on and the secret store exists."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from app.tenancy.repository import TokenRejected
from app.webhooks_out import signing
from app.webhooks_out.repository import WebhooksRepository
from app.webhooks_out.retry import retry_delay
from app.webhooks_out.sender import MAX_BODY, Sender, SendResult
from app.webhooks_out.service import secret_name
from app.workspace_secrets import SecretStore, SecretStoreError

logger = logging.getLogger("app.webhooks_out.runner")

BATCH = 20
PURGE_EVERY_S = 3600.0
SECRET_TTL_S = 60.0
NO_RETRY = frozenset({"too_large"})


def envelope(row: dict[str, Any]) -> dict[str, Any]:
    created = row.get("created_at")
    return {"id": "evt_" + str(row["event_id"]).replace("-", ""), "type": row["event"], "created_at": created if isinstance(created, str) else (created.isoformat() if isinstance(created, datetime) else None), "data": row.get("data") or {}}


def body_bytes(row: dict[str, Any]) -> bytes | None:
    """The JSON body, at most MAX_BODY bytes: a transcript that makes it too big is left out and said so; still too big: None."""
    event = envelope(row)
    raw = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(raw) <= MAX_BODY:
        return raw
    call = event["data"].get("call") if isinstance(event["data"], dict) else None
    if isinstance(call, dict) and call.get("transcript") is not None:
        call["transcript"] = None
        event["data"]["truncated"] = ["transcript"]
        raw = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(raw) <= MAX_BODY:
            return raw
    return None


class WebhookRunner:
    def __init__(self, repo: WebhooksRepository, store: SecretStore, sender: Sender, *, clock: Callable[[], float] = time.time, monotonic: Callable[[], float] = time.monotonic,
                 batch: int = BATCH) -> None:
        self._repo, self._store, self._sender = repo, store, sender
        self._clock, self._monotonic, self._batch = clock, monotonic, batch
        self._secrets: dict[tuple[str, int], tuple[float, str | None]] = {}
        self._purged_at: float | None = None

    def __repr__(self) -> str:
        return "WebhookRunner(<store>)"

    def _secret(self, tenant_id: str, endpoint_id: str, version: int) -> str | None:
        key = (f"{tenant_id}:{endpoint_id}", version)
        now = self._monotonic()
        hit = self._secrets.get(key)
        if hit is not None and now - hit[0] < SECRET_TTL_S:
            return hit[1]
        for stale in [k for k in self._secrets if k[0] == key[0] and k[1] != version]:
            del self._secrets[stale]   # an older version is never used again
        try:
            value = self._store.access(secret_name(uuid.UUID(tenant_id), uuid.UUID(endpoint_id)))
        except SecretStoreError:
            value = None
        self._secrets[key] = (now, value)
        return value

    def _attempt(self, row: dict[str, Any]) -> SendResult:
        data = row.get("data") or {}
        if data.get("gone"):
            return SendResult(True, None, None)   # what it was about is gone (erased or removed): nothing is sent, and nothing is left to retry
        secret = self._secret(str(row["tenant_id"]), str(row["endpoint_id"]), int(row["secret_version"]))
        if not secret:
            return SendResult(False, None, "no_secret")
        body = body_bytes(row)
        if body is None:
            return SendResult(False, None, "too_large")
        stamp = int(self._clock())
        headers = {"Content-Type": "application/json", "User-Agent": "Stack19-Webhooks/1", "Stack19-Signature": signing.header(secret, stamp, body),
                   "Stack19-Event-Id": envelope(row)["id"], "Stack19-Event": str(row["event"]), "Stack19-Delivery": str(row["id"])}
        return self._sender.post(str(row["url"]), body, headers)

    def run(self, token: str) -> int:
        """One pass. Returns how many deliveries were tried. A refused token is raised (the worker signs in again); anything else is logged by class name."""
        rows = self._repo.claim(token, self._batch)
        tried = 0
        for row in rows:
            try:
                result = self._attempt(row)
                failures = int(row.get("attempts") or 0) + 1
                retry = None if result.ok or result.error in NO_RETRY else retry_delay(failures, str(row["event"]))   # a body that is too big stays too big: dead at once
                self._repo.record(token, uuid.UUID(str(row["id"])), result.ok, result.status, result.error, retry)
                tried += 1
            except TokenRejected:
                raise
            except Exception as exc:   # noqa: BLE001 - one delivery never stops the others; its lease runs out and it is tried again
                logger.error("webhook delivery crashed: %s", exc.__class__.__name__)
        self._purge_if_due(token)
        return tried

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
            logger.error("webhook purge failed: %s", exc.__class__.__name__)
