"""The worker's IndiaMART pass (connectors plan C1 item 5; switch INDIAMART_PULL, off by default). One per scheduler tick, as the registered scheduler account.

The database says which businesses are due (an active IndiaMART source, their OWN key saved, real data allowed, not tried in the last 15 minutes: migration 20261231992400), so most ticks cost one call. For each one:
  1. the window: from five minutes before the end of the last good pull (the first time, the last 24 hours; never more than 7 days), up to now. The database stamps the attempt, so a second look inside five minutes
     is refused there (IndiaMART blocks a key for 15 minutes after more than five calls in a minute);
  2. the key is read from the secret store by the name the database gave (never stored here, never logged), IndiaMART is asked for that window;
  3. the buyers go through the same reading as every source (phone and e-mail cleaned, the Do-Not-Call mark, opt-out keys) and then the intake core, which de-duplicates by IndiaMART's own query id: the same buyer
     twice is one lead, also across the five-minute overlap and across a retry;
  4. a key IndiaMART refuses, or a saved key that cannot be found, is written as `expired`: the worker then leaves it alone (one look every 6 hours, or at once when a new key is saved) and the Lead sources card shows
     "needs a new key". Other failures (timeout, IndiaMART down, asked too often) change nothing: the next due pass asks for the same window again.
Nothing here logs a key, a buyer, a number or a message: only counts and closed words."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any, Protocol

from app.config import Settings
from app.connectors.errors import ProviderError
from app.connectors.indiamart import FixtureLeadSource, IndiaMartPull, LeadSource
from app.lead_sources.indiamart import row_of
from app.lead_sources.service import LeadSourcesService
from app.rpc_base import RpcClient
from app.tenancy.repository import TokenRejected
from app.workspace_secrets import SecretStore, SecretStoreError

logger = logging.getLogger("app.lead_sources.indiamart_pull")
MAX_BUSINESSES_PER_TICK = 5


class PullRepository(Protocol):
    def links(self, worker_token: str, limit: int) -> list[dict[str, Any]]: ...
    def begin(self, worker_token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def apply(self, worker_token: str, tenant_id: uuid.UUID, rows: list[dict[str, Any]], end: datetime, fetched: int) -> dict[str, Any]: ...
    def key_state(self, worker_token: str, tenant_id: uuid.UUID, state: str) -> bool: ...


class PostgrestPullRepository:
    def __init__(self, rest_url: str, anon_key: str) -> None:
        self._rpc = RpcClient(rest_url, anon_key)

    def links(self, worker_token: str, limit: int) -> list[dict[str, Any]]:
        got = self._rpc.call(worker_token, "scheduler_indiamart_links", {"p_limit": limit})
        return [x for x in got if isinstance(x, dict)] if isinstance(got, list) else []

    def begin(self, worker_token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(worker_token, "scheduler_indiamart_begin", {"p_tenant_id": str(tenant_id)})

    def apply(self, worker_token: str, tenant_id: uuid.UUID, rows: list[dict[str, Any]], end: datetime, fetched: int) -> dict[str, Any]:
        return self._rpc.object(worker_token, "scheduler_indiamart_apply", {"p_tenant_id": str(tenant_id), "p_rows": rows, "p_end": end.isoformat(), "p_fetched": fetched})

    def key_state(self, worker_token: str, tenant_id: uuid.UUID, state: str) -> bool:
        return self._rpc.call(worker_token, "scheduler_indiamart_key_state", {"p_tenant_id": str(tenant_id), "p_state": state}) is True


class IndiaMartPuller:
    def __init__(self, repo: PullRepository, store: SecretStore, service: LeadSourcesService, source_for: Callable[[str], LeadSource]) -> None:
        self._repo, self._store, self._service, self._source_for = repo, store, service, source_for

    def __repr__(self) -> str:
        return "IndiaMartPuller(<store>)"

    def run(self, token: str) -> dict[str, int]:
        """One pass. A refused token is raised (the worker signs in again); anything else is counted and logged by class name."""
        counts = {"businesses": 0, "leads_read": 0, "created": 0, "merged": 0, "existing": 0, "expired": 0, "failed": 0}
        for link in self._repo.links(token, MAX_BUSINESSES_PER_TICK):
            counts["businesses"] += 1
            try:
                self._one(token, link, counts)
            except TokenRejected:
                raise
            except Exception as exc:   # noqa: BLE001 - one business never stops the others
                counts["failed"] += 1
                logger.error("indiamart pull crashed: %s", exc.__class__.__name__)
        return counts

    def _one(self, token: str, link: dict[str, Any], counts: dict[str, int]) -> None:
        tenant = uuid.UUID(str(link["tenant_id"]))
        window = self._repo.begin(token, tenant)
        if window.get("status") != "ok":
            return   # off, or looked at less than five minutes ago
        start, end = (datetime.fromisoformat(str(window[k])) for k in ("start", "end"))
        try:
            key = self._store.access(str(link["secret_name"]))
        except SecretStoreError:
            counts["failed"] += 1
            return   # Secret Manager could not be read: not the key's fault; the next due pass tries again
        if not key:
            self._repo.key_state(token, tenant, "expired")   # the row says a key was saved and there is none: the owner must paste it again
            counts["expired"] += 1
            return
        try:
            leads = self._source_for(key).pull(start, end)
        except ProviderError as exc:
            if exc.code == "unauthorized":
                self._repo.key_state(token, tenant, "expired")
                counts["expired"] += 1
            else:
                counts["failed"] += 1
                logger.warning("indiamart pull: provider said %s", exc.code)   # a closed word: timeout, unavailable, rate_limited, bad_response, bad_window
            return
        prepared = self._service.prepare([row_of(lead) for lead in leads])
        done = self._repo.apply(token, tenant, prepared.rows, end, len(leads))
        found = done.get("counts")
        result: dict[str, Any] = found if isinstance(found, dict) else {}
        counts["leads_read"] += len(leads)
        counts["created"] += int(result.get("ready") or 0)
        counts["merged"] += int(result.get("duplicates_merged") or 0)
        counts["existing"] += int(result.get("already_imported") or 0) + prepared.in_file


def build_indiamart_puller(settings: Settings, rest_url: str, anon_key: str, service: LeadSourcesService, *, store: SecretStore | None = None, source_for: Callable[[str], LeadSource] | None = None) -> IndiaMartPuller | None:
    """The pass for the worker, or None while INDIAMART_PULL is off (the default) or there is no secret store to read the keys from."""
    if settings.indiamart_pull != "on":
        return None
    if store is None:
        from app.workspace_secrets_wiring import build_workspace_secrets

        shared = build_workspace_secrets(settings, rest_url, anon_key)
        store = shared.store if shared is not None else None
    if store is None:
        logger.warning("INDIAMART_PULL is on but there is no secret store (WORKSPACE_SECRETS): the worker pulls nothing")
        return None
    if source_for is None:
        source_for = (lambda _key: FixtureLeadSource()) if settings.indiamart_provider == "fake" and settings.is_development else IndiaMartPull
    return IndiaMartPuller(PostgrestPullRepository(rest_url, anon_key), store, service, source_for)
