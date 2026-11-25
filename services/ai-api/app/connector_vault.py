"""Where a workspace's connector credentials live: the workspace-secrets store (Secret Manager in production, in memory in tests), ONE JSON value per workspace and connector, named
`sme-ws-<workspace>-conn-<connector>`. The database keeps only the connector's own non-secret label and the last four characters; the value is read when a call is made and never logged, put in an
error or returned to a browser. Used by the commerce, notification and calendar connectors (docs/contracts/commerce-notify.md)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from app.workspace_secrets import SecretStore, SecretStoreError

_KIND = re.compile(r"[a-z][a-z0-9_]{1,30}")
MAX_VALUE = 4000


def secret_name(tenant_id: uuid.UUID, kind: str) -> str:
    if not _KIND.fullmatch(kind):
        raise ValueError("connector kind")
    return f"sme-ws-{tenant_id}-conn-{kind.replace('_', '-')}"


class ConnectorVault:
    def __init__(self, store: SecretStore) -> None:
        self._store = store

    def __repr__(self) -> str:
        return "ConnectorVault(<store>)"

    def put(self, tenant_id: uuid.UUID, kind: str, value: dict[str, Any]) -> None:
        raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        if len(raw) > MAX_VALUE:
            raise ValueError("value too large")
        self._store.put(secret_name(tenant_id, kind), raw)

    def get(self, tenant_id: uuid.UUID, kind: str) -> dict[str, Any] | None:
        """The stored value, or None when there is none or it cannot be read (a closed outcome; the reason is never carried)."""
        try:
            raw = self._store.access(secret_name(tenant_id, kind))
        except SecretStoreError:
            return None
        if not raw:
            return None
        try:
            value = json.loads(raw)
        except ValueError:
            return None
        return value if isinstance(value, dict) else None

    def delete(self, tenant_id: uuid.UUID, kind: str) -> None:
        self._store.delete(secret_name(tenant_id, kind))


def tail(value: str) -> str:
    """The last four letters or digits, for telling two keys apart; nothing for a short value (four of eight would be half of it)."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", value)
    return cleaned[-4:] if len(value) >= 12 and len(cleaned) >= 4 else ""
