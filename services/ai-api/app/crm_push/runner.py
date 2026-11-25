"""The worker's pass (one per scheduler tick). It asks the database for the due pushes (leased for 3 minutes), builds the record from the live rows, reads the connection's keys, pushes through the adapter and the guarded client,
and tells the database the result; the retry schedule (the same as outbound webhooks: 1 min, 5 min, 30 min, 2 h, 6 h) decides "again in N seconds" or "dead". A crash in one push leaves its lease to run out. Nothing here logs
an address, a record or a key. Runs only when CRM_PUSH=on and the secret store exists. A test lead, a sandbox call, or a person who is gone is left out ('skipped'), never sent."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from typing import Any

from app.crm_push.adapters.base import Adapter, Outcome
from app.crm_push.fields import clean_mapping, record_from
from app.crm_push.repository import CrmPushRepository
from app.crm_push.service import read_creds
from app.crm_push.transport import GuardedHttp, Http
from app.tenancy.repository import TokenRejected
from app.webhooks_out.retry import retry_delay
from app.workspace_secrets import SecretStore

logger = logging.getLogger("app.crm_push.runner")

BATCH = 10
PURGE_EVERY_S = 3600.0
SECRET_TTL_S = 60.0


class CrmPushRunner:
    def __init__(self, repo: CrmPushRepository, store: SecretStore, adapters: dict[str, Adapter], http: Http | None = None, *, monotonic: Callable[[], float] = time.monotonic, batch: int = BATCH) -> None:
        self._repo, self._store, self._adapters = repo, store, adapters
        self._http: Http = http or GuardedHttp()
        self._monotonic, self._batch = monotonic, batch
        self._creds: dict[tuple[str, int], tuple[float, dict[str, str] | None]] = {}
        self._purged_at: float | None = None

    def __repr__(self) -> str:
        return "CrmPushRunner(<store>)"

    def _keys(self, tenant_id: str, connection_id: str, version: int) -> dict[str, str] | None:
        key = (f"{tenant_id}:{connection_id}", version)
        now = self._monotonic()
        hit = self._creds.get(key)
        if hit is not None and now - hit[0] < SECRET_TTL_S:
            return hit[1]
        for stale in [k for k in self._creds if k[0] == key[0] and k[1] != version]:
            del self._creds[stale]
        value = read_creds(self._store, uuid.UUID(tenant_id), uuid.UUID(connection_id))
        self._creds[key] = (now, value)
        return value

    def _attempt(self, row: dict[str, Any]) -> Outcome:
        data = row.get("data") or {}
        if data.get("gone"):
            return Outcome(True, "skipped")   # what it was about is gone (erased or removed): nothing is sent
        adapter = self._adapters.get(str(row["type"]))
        if adapter is None or adapter.spec.needs_setup:
            return Outcome(False, "config")
        rec = record_from(str(row["event"]), "evt_" + str(row["event_id"]).replace("-", ""), data)
        if rec.sandbox:
            return Outcome(True, "skipped")   # a test lead or a sandbox call never reaches a business's tool
        keys = self._keys(str(row["tenant_id"]), str(row["connection_id"]), int(row["secret_version"]))
        if not keys:
            return Outcome(False, "no_secret")
        config = {str(k): str(v) for k, v in (row.get("config") or {}).items()}
        mapping = clean_mapping(row.get("mapping") or {}, adapter.spec.our_fields) or {}
        if adapter.check(keys, config):
            return Outcome(False, "config")
        return adapter.push(self._http, keys, config, mapping, rec)

    def run(self, token: str) -> int:
        """One pass. Returns how many pushes were tried. A refused token is raised (the worker signs in again); anything else is logged by class name."""
        rows = self._repo.claim(token, self._batch)
        tried = 0
        for row in rows:
            try:
                out = self._attempt(row)
                failures = int(row.get("attempts") or 0) + 1
                retry = None if out.ok or not out.retry else retry_delay(failures, str(row["event"]))
                self._repo.record(token, uuid.UUID(str(row["id"])), out.ok, out.status, None if out.ok else out.word, retry, out.word if out.ok else None)
                tried += 1
            except TokenRejected:
                raise
            except Exception as exc:   # noqa: BLE001 - one push never stops the others; its lease runs out and it is tried again
                logger.error("crm push crashed: %s", exc.__class__.__name__)
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
            logger.error("crm push purge failed: %s", exc.__class__.__name__)
