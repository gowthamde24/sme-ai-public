"""Builds the Connectors service and the worker's runner from the settings. None unless CRM_PUSH=on (the kill switch: every route answers 404 and the worker pushes nothing). The keys live in the workspace-secrets store
(WORKSPACE_SECRETS=gcp in production, fake in development); without it the routes answer 503 crm_push_unavailable and the worker does nothing."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.config import Settings
from app.crm_push.registry import build_registry
from app.crm_push.repository import PostgrestCrmPushRepository
from app.crm_push.runner import CrmPushRunner
from app.crm_push.service import CrmPush
from app.webhooks_out.wiring import _store

logger = logging.getLogger("app.crm_push.wiring")


def build_crm_push(settings: Settings, rest_url: str, anon_key: str, workspace_secrets: Any = None) -> CrmPush | None:
    if settings.crm_push != "on":
        return None
    store = _store(settings, workspace_secrets)
    if store is None:
        logger.warning("CRM_PUSH is on but there is no secret store (WORKSPACE_SECRETS): the routes answer 503 crm_push_unavailable")
    return CrmPush(PostgrestCrmPushRepository(rest_url, anon_key), store, build_registry(settings))


def build_crm_push_runner(settings: Settings, rest_url: str, anon_key: str, workspace_secrets: Any = None) -> CrmPushRunner | None:
    if settings.crm_push != "on":
        return None
    store = _store(settings, workspace_secrets)
    if store is None:
        logger.warning("CRM_PUSH is on but there is no secret store (WORKSPACE_SECRETS): the worker pushes nothing")
        return None
    return CrmPushRunner(PostgrestCrmPushRepository(rest_url, anon_key), store, build_registry(settings))
