"""The feed and web-push data access (job BY, ADR 0077): SECURITY DEFINER functions of migration 20261118090200. A person's calls use their own token; the worker's three (`pending`, `mark`, `report`) use the
registered scheduler account's token and refuse everyone else. The subscription endpoint and keys leave the database ONLY in `pending`, to the sender."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient


class NotificationsRepository(Protocol):
    def feed(self, token: str, tenant_id: uuid.UUID, limit: int) -> dict[str, Any]: ...
    def mark_seen(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def subscribe(self, token: str, endpoint: str, p256dh: str, auth: str) -> dict[str, Any]: ...
    def unsubscribe(self, token: str, endpoint: str) -> dict[str, Any]: ...
    def prefs(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set_prefs(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]: ...
    def pending(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def mark(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, items: list[dict[str, Any]]) -> int: ...
    def report(self, token: str, subscription_id: uuid.UUID, outcome: str) -> None: ...


class PostgrestNotificationsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key)

    def feed(self, token: str, tenant_id: uuid.UUID, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "notifications_list", {"p_tenant_id": str(tenant_id), "p_limit": limit})

    def mark_seen(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "notifications_mark_seen", {"p_tenant_id": str(tenant_id)})

    def subscribe(self, token: str, endpoint: str, p256dh: str, auth: str) -> dict[str, Any]:
        return self._rpc.object(token, "push_subscribe", {"p_endpoint": endpoint, "p_p256dh": p256dh, "p_auth": auth})

    def unsubscribe(self, token: str, endpoint: str) -> dict[str, Any]:
        return self._rpc.object(token, "push_unsubscribe", {"p_endpoint": endpoint})

    def prefs(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "push_prefs_get", {"p_tenant_id": str(tenant_id)})

    def set_prefs(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        return self._rpc.object(token, "push_prefs_set", {"p_tenant_id": str(tenant_id), "p_enabled": enabled})

    def pending(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "push_worker_pending", {"p_limit": limit})

    def mark(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, items: list[dict[str, Any]]) -> int:
        result = self._rpc.call(token, "push_worker_mark", {"p_tenant_id": str(tenant_id), "p_user_id": str(user_id), "p_items": items})
        return int(result) if isinstance(result, int) else 0

    def report(self, token: str, subscription_id: uuid.UUID, outcome: str) -> None:
        self._rpc.call(token, "push_worker_report", {"p_subscription_id": str(subscription_id), "p_outcome": outcome})
