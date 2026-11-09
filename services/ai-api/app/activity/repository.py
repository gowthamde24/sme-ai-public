"""Everything it did, and the limits (migration 20261231410000: activity_log, limits_get, limits_tighten) behind an interface. The caller's own token: the database decides who sees and changes what."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class ActivityRepository(Protocol):
    def activity(self, token: str, tenant_id: uuid.UUID, *, limit: int, before_at: datetime | None, before_key: str | None, kind: str | None) -> dict[str, Any]: ...
    def limits(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def tighten(self, token: str, tenant_id: uuid.UUID, changes: dict[str, Any]) -> dict[str, Any]: ...


class PostgrestActivityRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def close(self) -> None:
        self._rpc.close()

    def activity(self, token: str, tenant_id: uuid.UUID, *, limit: int, before_at: datetime | None, before_key: str | None, kind: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "activity_log", {"p_tenant_id": str(tenant_id), "p_limit": limit, "p_before_at": before_at.isoformat() if before_at else None, "p_before_key": before_key, "p_kind": kind})

    def limits(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "limits_get", {"p_tenant_id": str(tenant_id)})

    def tighten(self, token: str, tenant_id: uuid.UUID, changes: dict[str, Any]) -> dict[str, Any]:
        """All or nothing. The answer is {"ok": true, "limits": ...} or {"ok": false, "reason": ..., "field": ...}."""
        return self._rpc.object(token, "limits_tighten", {"p_tenant_id": str(tenant_id), "p_changes": changes})
