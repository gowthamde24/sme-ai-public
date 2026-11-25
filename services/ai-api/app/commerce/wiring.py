"""Builds commerce from the settings. None unless COMMERCE=on (the kill switch: every route answers 404 and the worker does nothing). The stores' keys live in the workspace-secrets store
(WORKSPACE_SECRETS=gcp in production, fake in development); without it the routes answer 503 commerce_unavailable and no store can be connected."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from app.commerce.repository import PostgrestCommerceRepository
from app.commerce.service import Commerce
from app.config import Settings
from app.connector_vault import ConnectorVault
from app.outbound_http import GuardedHttp
from app.scheduler.session import PrincipalSession
from app.workspace_secrets import FakeSecretStore, GcpSecretStore, SecretStore

logger = logging.getLogger("app.commerce.wiring")
PURGE_EVERY_S = 3600.0


def _store(settings: Settings, shared: Any = None) -> SecretStore | None:
    if shared is not None and getattr(shared, "store", None) is not None:
        return shared.store  # type: ignore[no-any-return]
    mode = (settings.workspace_secrets or "off").strip().lower()
    if mode == "fake" and settings.is_development:
        return FakeSecretStore()
    if mode == "gcp":
        try:
            return GcpSecretStore(settings.workspace_secrets_project or "")
        except ValueError:
            return None
    return None


def build_commerce(settings: Settings, rest_url: str, auth_url: str, anon_key: str, workspace_secrets: Any = None) -> Commerce | None:
    if settings.commerce != "on":
        return None
    store = _store(settings, workspace_secrets)
    if store is None:
        logger.warning("COMMERCE is on but there is no secret store (WORKSPACE_SECRETS): the routes answer 503 commerce_unavailable")
    base = (settings.public_base_url or "").strip().rstrip("/") or None
    if base is not None and not base.startswith("https://") and not (settings.is_development and base.startswith("http://localhost")):
        logger.warning("COMMERCE is on but PUBLIC_BASE_URL is not an https address: no store can be connected")
        base = None
    receiver: PrincipalSession | None = None
    if settings.scheduler_email and settings.scheduler_password and settings.scheduler_password.get_secret_value():
        receiver = PrincipalSession(auth_url, anon_key, settings.scheduler_email, settings.scheduler_password.get_secret_value(), client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)))
    return Commerce(PostgrestCommerceRepository(rest_url, anon_key), ConnectorVault(store) if store is not None else None, GuardedHttp(), public_base_url=base, receiver=receiver)


class CommerceRunner:
    """The worker's pass (one per scheduler tick): checkouts whose wait is over become a call-back lead; once an hour the old rows are removed."""

    def __init__(self, commerce: Commerce, lead_sources: Any, *, monotonic: Any = time.monotonic) -> None:
        self._commerce, self._lead_sources, self._mono = commerce, lead_sources, monotonic
        self._purged_at: float | None = None

    def run(self, token: str) -> int:
        done = self._commerce.run_checkouts(token, self._lead_sources)
        now = self._mono()
        if self._purged_at is None or now - self._purged_at >= PURGE_EVERY_S:
            self._purged_at = now
            self._commerce.repo.purge(token)
        return done


def build_commerce_runner(settings: Settings, rest_url: str, auth_url: str, anon_key: str, lead_sources: Any, workspace_secrets: Any = None) -> CommerceRunner | None:
    commerce = build_commerce(settings, rest_url, auth_url, anon_key, workspace_secrets)
    if commerce is None or commerce.vault is None:
        return None
    return CommerceRunner(commerce, lead_sources)
