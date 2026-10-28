"""The browser voice's daily numbers in the database (job DV follow-up, migration 20261213090000): `browser_voice_usage_get` / `_add`, called with the member's own token. Numbers only."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient


class UsageStore(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def add(self, token: str, tenant_id: uuid.UUID, seconds: int, chars: int, sessions: int) -> dict[str, Any]: ...


class PostgrestUsageStore:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "browser_voice_usage_get", {"p_tenant_id": str(tenant_id)})

    def add(self, token: str, tenant_id: uuid.UUID, seconds: int, chars: int, sessions: int) -> dict[str, Any]:
        return self._rpc.object(token, "browser_voice_usage_add", {"p_tenant_id": str(tenant_id), "p_seconds": seconds, "p_chars": chars, "p_sessions": sessions})
