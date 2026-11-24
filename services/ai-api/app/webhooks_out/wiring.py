"""Builds outbound webhooks from the settings. None unless WEBHOOKS_OUT=on (the kill switch: every route answers 404 and the worker sends nothing). The signing secrets live in the workspace-secrets
store (WORKSPACE_SECRETS=gcp in production, fake in development); without it the routes answer 503 webhooks_out_unavailable and the worker does nothing."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.webhooks_out.repository import PostgrestWebhooksRepository
from app.webhooks_out.runner import WebhookRunner
from app.webhooks_out.sender import Sender
from app.webhooks_out.service import WebhooksOut
from app.workspace_secrets import FakeSecretStore, GcpSecretStore, SecretStore

logger = logging.getLogger("app.webhooks_out.wiring")


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


def build_webhooks_out(settings: Settings, rest_url: str, anon_key: str, workspace_secrets: Any = None) -> WebhooksOut | None:
    if settings.webhooks_out != "on":
        return None
    store = _store(settings, workspace_secrets)
    if store is None:
        logger.warning("WEBHOOKS_OUT is on but there is no secret store (WORKSPACE_SECRETS): the routes answer 503 webhooks_out_unavailable")
    return WebhooksOut(PostgrestWebhooksRepository(rest_url, anon_key), store)


def build_webhook_runner(settings: Settings, rest_url: str, anon_key: str, workspace_secrets: Any = None) -> WebhookRunner | None:
    if settings.webhooks_out != "on":
        return None
    store = _store(settings, workspace_secrets)
    if store is None:
        logger.warning("WEBHOOKS_OUT is on but there is no secret store (WORKSPACE_SECRETS): the worker sends no webhooks")
        return None
    return WebhookRunner(PostgrestWebhooksRepository(rest_url, anon_key), store, Sender())
