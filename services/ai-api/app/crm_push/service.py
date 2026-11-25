"""What the routes and the worker pass share: the repository, the adapters, the place the keys live (Secret Manager through the workspace-secrets store: `sme-ws-<workspace>-crm-<connection>`, ONE JSON value of the keys)
and the guarded client (injectable, for the tests)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid

from app.crm_push.adapters.base import Adapter
from app.crm_push.repository import CrmPushRepository
from app.crm_push.transport import GuardedHttp, Http
from app.workspace_secrets import SecretStore, SecretStoreError


def secret_name(tenant_id: uuid.UUID, connection_id: uuid.UUID) -> str:
    return f"sme-ws-{tenant_id}-crm-{connection_id}"


def read_creds(store: SecretStore, tenant_id: uuid.UUID, connection_id: uuid.UUID) -> dict[str, str] | None:
    """The keys of one connection, or None (not there, or unreadable). Never logged."""
    try:
        raw = store.access(secret_name(tenant_id, connection_id))
    except SecretStoreError:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else None


class CrmPush:
    def __init__(self, repo: CrmPushRepository, store: SecretStore | None, adapters: dict[str, Adapter], *, http: Http | None = None) -> None:
        self.repo = repo
        self.store = store
        self.adapters = adapters
        self.http: Http = http or GuardedHttp()

    def __repr__(self) -> str:
        return "CrmPush(<store>)"
