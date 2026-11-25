"""Builds notifications out from the settings. None unless NOTIFY_OUT=on (the kill switch: every route answers 404 and the worker sends nothing). The connections' secrets live in the workspace-secrets store
(WORKSPACE_SECRETS=gcp in production, fake in development); without it the routes answer 503 notify_out_unavailable and the worker does nothing."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.connector_vault import ConnectorVault
from app.notify_out.repository import PostgrestNotifyRepository
from app.notify_out.runner import NotifyRunner
from app.notify_out.service import NotifyOut
from app.outbound_http import GuardedHttp
from app.workspace_secrets import FakeSecretStore, GcpSecretStore, SecretStore

logger = logging.getLogger("app.notify_out.wiring")


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


def build_notify_out(settings: Settings, rest_url: str, anon_key: str, workspace_secrets: Any = None) -> NotifyOut | None:
    if settings.notify_out != "on":
        return None
    store = _store(settings, workspace_secrets)
    if store is None:
        logger.warning("NOTIFY_OUT is on but there is no secret store (WORKSPACE_SECRETS): the routes answer 503 notify_out_unavailable")
    return NotifyOut(PostgrestNotifyRepository(rest_url, anon_key), ConnectorVault(store) if store is not None else None, GuardedHttp())


def build_notify_runner(settings: Settings, rest_url: str, anon_key: str, workspace_secrets: Any = None) -> NotifyRunner | None:
    if settings.notify_out != "on":
        return None
    store = _store(settings, workspace_secrets)
    if store is None:
        logger.warning("NOTIFY_OUT is on but there is no secret store (WORKSPACE_SECRETS): the worker sends no notifications")
        return None
    return NotifyRunner(PostgrestNotifyRepository(rest_url, anon_key), ConnectorVault(store), GuardedHttp())
